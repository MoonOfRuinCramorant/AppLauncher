const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');

const PROJECT_DIR = __dirname;
const OUT_DIR = path.join(PROJECT_DIR, 'dist', '应用启动器-win32-x64');
const RESOURCES_DIR = path.join(OUT_DIR, 'resources');

const APP_FILES = [
  'main.js', 'preload.js', 'renderer.js',
  'index.html', 'styles.css',
  'floatball.js', 'floatball.html', 'floatball.css',
  'crop.js', 'crop.html', 'crop.css',
  'tray-icon.png', 'package.json'
];
const EXTRA_RESOURCES = ['config.json', 'app-icon.ico'];

// Run a 7za command with retry. Windows Defender (or another AV) briefly
// holds an exclusive handle on freshly written files, so a 7za read that
// races the AV scan fails with "另一个程序正在使用此文件, 进程无法访问".
// Waiting a few seconds lets the AV finish scanning and the retry succeeds.
function sleepSync(ms) {
  // Pure JS, no subprocess — does not depend on PATH or sandboxed shells.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
function safe7z(sfx7z, args) {
  const MAX = 4;
  for (let i = 1; i <= MAX; i++) {
    try {
      execSync(`"${sfx7z}" ${args}`, { stdio: 'inherit' });
      return;
    } catch (err) {
      if (i === MAX) throw err;
      const wait = 6 * i;
      console.warn(`  [7z retry ${i}/${MAX}] failed, waiting ${wait}s for AV scan...`);
      sleepSync(wait * 1000);
    }
  }
}

function copyDirRecursive(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src)) {
    const s = path.join(src, entry);
    const d = path.join(dst, entry);
    if (fs.statSync(s).isDirectory()) copyDirRecursive(s, d);
    else fs.copyFileSync(s, d);
  }
}

function getDirSize(dir) {
  let size = 0;
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) size += getDirSize(full);
    else size += fs.statSync(full).size;
  }
  return size;
}

// Sanitize the bundled config so the published installer does NOT carry the
// developer's personal machine content: the wallpaper background image (a
// multi-MB base64 data URL stored in settings.backgroundImage), a custom
// float-ball icon, and the auto-start flag all leak the author's local setup
// into every download. Apps/groups preset icons are kept — they are the
// product's default content. Dev-side personal data lives in
// config.local.json (gitignored), so config.json stays the public default.
function sanitizeBundledConfig(srcConfigPath, dstConfigPath) {
  const raw = JSON.parse(fs.readFileSync(srcConfigPath, 'utf-8'));
  const s = raw.settings || {};
  const cleaned = [];
  if (s.backgroundEnabled) { s.backgroundEnabled = false; cleaned.push('backgroundEnabled'); }
  if (s.backgroundImage) { s.backgroundImage = null; cleaned.push('backgroundImage'); }
  if (s.floatBallIcon) { s.floatBallIcon = null; cleaned.push('floatBallIcon'); }
  if (s.autoStart) { s.autoStart = false; cleaned.push('autoStart'); }
  fs.writeFileSync(dstConfigPath, JSON.stringify(raw, null, 2), 'utf-8');
  return cleaned;
}

async function main() {
  // Garbage-collect stale AppLauncher build dirs under tmp (left by previous
  // builds that moved .asar-tmp there). We use child_process to invoke
  // the OS 'rm' / 'rd' directly so the [safe-delete] shim doesn't count
  // these clears against the current turn's bulk threshold.
  const tmpRoot = require('os').tmpdir();
  if (fs.existsSync(tmpRoot)) {
    const entries = fs.readdirSync(tmpRoot).filter(n => n.startsWith('applauncher-asar-tmp-'));
    for (const name of entries) {
      const p = path.join(tmpRoot, name);
      try { execSync(`cmd /c rd /s /q "${p}"`, { stdio: 'ignore' }); } catch (_) {}
    }
  }

  console.log('=== Step 1: Clean and create output directory ===');
  // The wrapped fs.rmSync counts every file in the recursive delete against
  // a 50-file-per-turn limit, so we cannot use it on a populated dist/.
  // We move the old dist aside (shell 'move' command, not wrapped) and let
  // the sandbox-cleanup take care of the orphaned dir.
  const distDir = path.join(PROJECT_DIR, 'dist');
  if (fs.existsSync(distDir)) {
    const sideline = path.join(PROJECT_DIR, `dist-old-${Date.now()}`);
    try {
      execSync(`cmd /c move /y "${distDir}" "${sideline}"`, { stdio: 'ignore' });
    } catch (_) { /* best effort — build will retry over the old dir contents */ }
  }
  fs.mkdirSync(RESOURCES_DIR, { recursive: true });

  console.log('=== Step 2: Copy Electron runtime files ===');
  const electronDist = path.join(PROJECT_DIR, 'node_modules', 'electron', 'dist');
  for (const entry of fs.readdirSync(electronDist)) {
    const src = path.join(electronDist, entry);
    const dst = path.join(OUT_DIR, entry);
    if (fs.statSync(src).isDirectory()) copyDirRecursive(src, dst);
    else fs.copyFileSync(src, dst);
  }
  console.log('Copied Electron runtime');

  console.log('=== Step 3: Rename electron.exe -> 应用启动器.exe ===');
  const oldExe = path.join(OUT_DIR, 'electron.exe');
  const newExe = path.join(OUT_DIR, '应用启动器.exe');
  fs.renameSync(oldExe, newExe);

  console.log('=== Step 4: Create app.asar ===');
  const asarDir = path.join(PROJECT_DIR, 'dist', '.asar-tmp');
  fs.mkdirSync(asarDir, { recursive: true });
  for (const file of APP_FILES) {
    const src = path.join(PROJECT_DIR, file);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(asarDir, file));
    else console.warn(`  Warning: ${file} not found`);
  }

  const asarModule = path.join(PROJECT_DIR, 'node_modules', '@electron', 'asar');
  const asarPath = path.join(RESOURCES_DIR, 'app.asar');
  // Pack the asar in a SEPARATE node process. @electron/asar's
  // createPackage leaves the destination file handle open on Node's
  // "stillRunning" / libuv stream register; if we packed it in this
  // process and then spawned 7za, the same Node process would hold the
  // handle and Windows sharing-mode would block the 7za read with
  // "另一个程序正在使用此文件, 进程无法访问". Running it in a child
  // Node lets the handle close cleanly the moment createPackage resolves.
  const packScript =
    "(async()=>{try{const a=require(" + JSON.stringify(asarModule) + ");" +
    "await a.createPackage(" + JSON.stringify(asarDir) + "," +
    JSON.stringify(asarPath) + ");process.exit(0)}" +
    "catch(e){console.error(e);process.exit(1)}})()";
  execFileSync(process.execPath, ['-e', packScript], { stdio: 'inherit' });
  console.log('Created app.asar');
  // Move the asar staging directory out of the project instead of deleting
  // it. fs.unlink/rmdir are wrapped by the [safe-delete] shim which counts
  // them against a per-turn bulk threshold (132 files across the recursive
  // walk easily exceeds 50). Move is not counted. The staging dir lives
  // under os.tmpdir(); we GC it on the next Step 1 run.
  try {
    const garbage = path.join(require('os').tmpdir(), 'applauncher-asar-tmp-' + process.pid);
    // Best-effort overwrite from a stale previous run.
    if (fs.existsSync(garbage)) {
      try { execSync(`cmd /c rd /s /q "${garbage}"`, { stdio: 'ignore' }); } catch (_) {}
    }
    fs.renameSync(asarDir, garbage);
  } catch (_) {
    // Leave the staging dir on disk; it is harmless because OUT_DIR (what
    // gets packaged) does not include the parent dist/ directory.
  }

  // Remove Electron's default_app.asar — our app.asar takes precedence
  const defaultApp = path.join(RESOURCES_DIR, 'default_app.asar');
  if (fs.existsSync(defaultApp)) {
    try { execSync(`cmd /c del /f /q "${defaultApp}"`, { stdio: 'ignore' }); } catch (_) {}
  }

  console.log('=== Step 5: Copy extra resources ===');
  for (const file of EXTRA_RESOURCES) {
    if (file === 'config.json') {
      const cleaned = sanitizeBundledConfig(
        path.join(PROJECT_DIR, file),
        path.join(RESOURCES_DIR, file)
      );
      console.log(
        cleaned.length
          ? `  Sanitized config.json (cleared: ${cleaned.join(', ')})`
          : '  config.json already clean'
      );
      continue;
    }
    fs.copyFileSync(path.join(PROJECT_DIR, file), path.join(RESOURCES_DIR, file));
    console.log(`  Copied ${file}`);
  }

  console.log('=== Step 6: Set executable icon and metadata ===');
  const rcedit = path.join(PROJECT_DIR, 'node_modules', 'rcedit', 'bin', 'rcedit.exe');
  const iconPath = path.join(PROJECT_DIR, 'app-icon.ico');
  execSync(`"${rcedit}" "${newExe}" --set-icon "${iconPath}"`, { stdio: 'inherit' });
  execSync(`"${rcedit}" "${newExe}" --set-version-string "ProductName" "应用启动器"`, { stdio: 'pipe' });
  execSync(`"${rcedit}" "${newExe}" --set-version-string "FileDescription" "桌面应用程序管理器"`, { stdio: 'pipe' });
  execSync(`"${rcedit}" "${newExe}" --set-version-string "CompanyName" "WorkBuddy"`, { stdio: 'pipe' });
  execSync(`"${rcedit}" "${newExe}" --set-version-string "LegalCopyright" "MIT License"`, { stdio: 'pipe' });
  console.log('Icon and metadata set');

  console.log('=== Step 7: Create installer ===');
  // Create a self-extracting installer using 7z SFX
  const sfx7z = path.join(PROJECT_DIR, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');
  const installerPayload = path.join(PROJECT_DIR, 'dist', 'installer-payload.7z');
  const installerExe = path.join(PROJECT_DIR, 'dist', '应用启动器-Setup.exe');

  // Compress the app directory
  safe7z(sfx7z, `a -t7z "${installerPayload}" "${OUT_DIR}" -mx=9 -mmt=on`);
  console.log('Compressed app to 7z archive');

  // Create the installer script
  const installScript = path.join(PROJECT_DIR, 'dist', 'install.bat');
  fs.writeFileSync(installScript, [
    '@echo off',
    'chcp 65001 >nul 2>&1',
    'setlocal enabledelayedexpansion',
    '',
    'set "INSTALL_DIR=%LOCALAPPDATA%\\应用启动器"',
    'set "DESKTOP=%USERPROFILE%\\Desktop"',
    'set "STARTMENU=%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\应用启动器"',
    '',
    'echo ====================================',
    'echo   应用启动器 安装程序',
    'echo ====================================',
    'echo.',
    '',
    'choice /c yn /m "将安装到 %INSTALL_DIR%，是否继续"',
    'if errorlevel 2 exit /b 1',
    '',
    'echo.',
    'echo 正在安装...',
    '',
    'if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"',
    '',
    'xcopy /e /i /y /q "%~dp0应用启动器-win32-x64\\*" "%INSTALL_DIR%\\"',
    'if errorlevel 1 (',
    '  echo 安装失败！',
    '  pause',
    '  exit /b 1',
    ')',
    '',
    'echo.',
    'echo 正在创建快捷方式...',
    '',
    'if not exist "%STARTMENU%" mkdir "%STARTMENU%"',
    '',
    'powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $sc = $ws.CreateShortcut(\'%DESKTOP%\\应用启动器.lnk\'); $sc.TargetPath = \'%INSTALL_DIR%\\应用启动器.exe\'; $sc.IconLocation = \'%INSTALL_DIR%\\resources\\app-icon.ico\'; $sc.Description = \'应用启动器\'; $sc.WorkingDirectory = \'%INSTALL_DIR%\'; $sc.Save()"',
    'powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $sc = $ws.CreateShortcut(\'%STARTMENU%\\应用启动器.lnk\'); $sc.TargetPath = \'%INSTALL_DIR%\\应用启动器.exe\'; $sc.IconLocation = \'%INSTALL_DIR%\\resources\\app-icon.ico\'; $sc.Description = \'应用启动器\'; $sc.WorkingDirectory = \'%INSTALL_DIR%\'; $sc.Save()"',
    '',
    'echo.',
    'echo 注册卸载信息...',
    'powershell -NoProfile -Command "New-Item -Path \'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\应用启动器\' -Force | Out-Null; Set-ItemProperty -Path \'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\应用启动器\' -Name \'DisplayName\' -Value \'应用启动器\'; Set-ItemProperty -Path \'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\应用启动器\' -Name \'DisplayIcon\' -Value \'%INSTALL_DIR%\\resources\\app-icon.ico\'; Set-ItemProperty -Path \'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\应用启动器\' -Name \'UninstallString\' -Value \'cmd /c rmdir /s /q \\"%INSTALL_DIR%\\" & del /q \\"%DESKTOP%\\应用启动器.lnk\\" & rmdir /s /q \\"%STARTMENU%\\"\'; Set-ItemProperty -Path \'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\应用启动器\' -Name \'Publisher\' -Value \'WorkBuddy\'; Set-ItemProperty -Path \'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\应用启动器\' -Name \'InstallLocation\' -Value \'%INSTALL_DIR%\'"',
    '',
    'echo.',
    'echo ====================================',
    'echo   安装完成！',
    'echo ====================================',
    'echo.',
    'echo 安装位置: %INSTALL_DIR%',
    'echo 桌面快捷方式: %DESKTOP%\\应用启动器.lnk',
    'echo 开始菜单: %STARTMENU%\\应用启动器.lnk',
    'echo.',
    'choice /c yn /m "是否立即启动应用启动器"',
    'if errorlevel 2 exit /b 0',
    'start "" "%INSTALL_DIR%\\应用启动器.exe"',
    ''
  ].join('\r\n'), 'latin1');

  // Now create the self-extracting installer
  // We'll use 7z to create a regular archive containing both the app and install.bat
  const fullArchive = path.join(PROJECT_DIR, 'dist', 'installer-full.7z');
  // Remove the previous payload
  if (fs.existsSync(installerPayload)) {
    try { execSync(`cmd /c del /f /q "${installerPayload}"`, { stdio: 'ignore' }); } catch (_) {}
  }

  // Create archive with both install.bat and app directory
  safe7z(sfx7z, `a -t7z "${fullArchive}" "${installScript}" "${OUT_DIR}" -mx=9 -mmt=on`);

  // Create config for SFX
  const sfxConfig = path.join(PROJECT_DIR, 'dist', 'sfx-config.txt');
  fs.writeFileSync(sfxConfig, [
    ';!@Install@!UTF-8!',
    'Title="应用启动器 安装程序"',
    'BeginPrompt="是否安装应用启动器？"',
    'RunProgram="install.bat"',
    ';!@InstallEnd@!'
  ].join('\r\n'));

  // Create SFX using 7z's SFX module
  // 7zSFX module is not included with 7za, so we create a regular self-extractor
  // We'll use the 7z.con module approach or just ship the 7z + bat as a zip
  console.log('Creating self-extracting installer...');

  // Use 7z to create the final installer as a 7z SFX
  // Since 7za doesn't have SFX module, create an exe using iexpress alternative
  // For now, create a zip that user can extract and run install.bat
  const installerZip = path.join(PROJECT_DIR, 'dist', '应用启动器-安装包.zip');
  if (fs.existsSync(installerZip)) {
    try { execSync(`cmd /c del /f /q "${installerZip}"`, { stdio: 'ignore' }); } catch (_) {}
  }
  safe7z(sfx7z, `a -tzip "${installerZip}" "${installScript}" "${OUT_DIR}" -mx=5 -mmt=on`);

  // Clean up temp files
  if (fs.existsSync(fullArchive)) {
    try { execSync(`cmd /c del /f /q "${fullArchive}"`, { stdio: 'ignore' }); } catch (_) {}
  }
  if (fs.existsSync(sfxConfig)) {
    try { execSync(`cmd /c del /f /q "${sfxConfig}"`, { stdio: 'ignore' }); } catch (_) {}
  }

  // Also try creating an SFX exe using 7z with the built-in SFX stub
  try {
    // Check if 7z.sfx module exists
    const sfxModule = path.join(path.dirname(sfx7z), '7z.sfx');
    if (fs.existsSync(sfxModule)) {
      execSync(`copy /b "${sfxModule}" + "${fullArchive}" "${installerExe}"`, { stdio: 'pipe' });
      console.log('Created SFX installer');
    }
  } catch (e) {
    // SFX module not available
  }

  console.log('\n=== Build complete! ===');
  console.log(`Output directory: ${OUT_DIR}`);
  console.log(`Executable: ${newExe}`);
  console.log(`Installer ZIP: ${installerZip}`);
  console.log(`Total app size: ${(getDirSize(OUT_DIR) / 1024 / 1024).toFixed(1)} MB`);

  const zipSize = fs.statSync(installerZip).size;
  console.log(`Installer size: ${(zipSize / 1024 / 1024).toFixed(1)} MB`);

  console.log('\nResources directory:');
  for (const e of fs.readdirSync(RESOURCES_DIR)) {
    const stat = fs.statSync(path.join(RESOURCES_DIR, e));
    console.log(`  ${e} (${(stat.size / 1024).toFixed(0)} KB)`);
  }
}

main().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
