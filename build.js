const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PROJECT_DIR = __dirname;
const OUT_DIR = path.join(PROJECT_DIR, 'dist', '应用启动器-win32-x64');
const RESOURCES_DIR = path.join(OUT_DIR, 'resources');

const APP_FILES = [
  'main.js', 'preload.js', 'renderer.js',
  'index.html', 'styles.css',
  'floatball.js', 'floatball.html', 'floatball.css',
  'tray-icon.png', 'package.json'
];
const EXTRA_RESOURCES = ['config.json', 'app-icon.ico'];

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

async function main() {
  console.log('=== Step 1: Clean and create output directory ===');
  if (fs.existsSync(path.join(PROJECT_DIR, 'dist')))
    fs.rmSync(path.join(PROJECT_DIR, 'dist'), { recursive: true, force: true });
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

  const asar = require('@electron/asar');
  const asarPath = path.join(RESOURCES_DIR, 'app.asar');
  await asar.createPackage(asarDir, asarPath);
  console.log('Created app.asar');
  fs.rmSync(asarDir, { recursive: true, force: true });

  // Remove Electron's default_app.asar — our app.asar takes precedence
  const defaultApp = path.join(RESOURCES_DIR, 'default_app.asar');
  if (fs.existsSync(defaultApp)) fs.unlinkSync(defaultApp);

  console.log('=== Step 5: Copy extra resources ===');
  for (const file of EXTRA_RESOURCES) {
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
  execSync(`"${sfx7z}" a -t7z "${installerPayload}" "${OUT_DIR}" -mx=9 -mmt=on`, { stdio: 'inherit' });
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
  if (fs.existsSync(installerPayload)) fs.unlinkSync(installerPayload);

  // Create archive with both install.bat and app directory
  execSync(`"${sfx7z}" a -t7z "${fullArchive}" "${installScript}" "${OUT_DIR}" -mx=9 -mmt=on`, { stdio: 'inherit' });

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
  if (fs.existsSync(installerZip)) fs.unlinkSync(installerZip);
  execSync(`"${sfx7z}" a -tzip "${installerZip}" "${installScript}" "${OUT_DIR}" -mx=5 -mmt=on`, { stdio: 'inherit' });

  // Clean up temp files
  if (fs.existsSync(fullArchive)) fs.unlinkSync(fullArchive);
  if (fs.existsSync(sfxConfig)) fs.unlinkSync(sfxConfig);

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
