#include "..\generated\InstallerBranding.iss"
#define LlmGoogleDriveFileId "1AX-u6SzoxrqYio04pYB_QxU3CAThuj33"

[Setup]
AppId={#MyAppId}
AppName={#MyAppName}
AppVersion=1.0.0
DefaultDirName={#MyDefaultDirName}
DisableProgramGroupPage=yes
OutputDir=..\dist
OutputBaseFilename={#MyOutputBaseFilename}
Compression=lzma
SolidCompression=yes
WizardStyle=modern
SetupIconFile=..\stage\runtime\branding\app.ico
UninstallDisplayIcon={app}\runtime\branding\app.ico

[Files]
Source: "..\stage\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "download-llm-from-drive.ps1"; Flags: dontcopy

[Icons]
Name: "{autoprograms}\{#MyShortcutName}"; Filename: "{app}\{#MyExeName}"; WorkingDir: "{app}"; IconFilename: "{app}\runtime\branding\app.ico"
Name: "{autodesktop}\{#MyShortcutName}"; Filename: "{app}\{#MyExeName}"; WorkingDir: "{app}"; IconFilename: "{app}\runtime\branding\app.ico"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create desktop shortcuts"; GroupDescription: "Additional icons:"

[Code]
var
  LlmInstallPage: TOutputProgressWizardPage;

function PowerShellPath(): string;
begin
  Result := ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe');
end;

function IsLlmInstalled(): Boolean;
begin
  Result :=
    FileExists(ExpandConstant('{app}\llm\bin\llama-server.exe')) and
    FileExists(ExpandConstant('{app}\chatv2_llm_server_path.txt')) and
    FileExists(ExpandConstant('{app}\chatv2_llm_model_path.txt'));
end;

procedure InstallMandatoryLlm();
var
  ScriptPath: string;
  Params: string;
  ResultCode: Integer;
begin
  if IsLlmInstalled() then
    exit;

  ExtractTemporaryFile('download-llm-from-drive.ps1');
  ScriptPath := ExpandConstant('{tmp}\download-llm-from-drive.ps1');
  Params :=
    '-NoProfile -ExecutionPolicy Bypass -File "' + ScriptPath + '"' +
    ' -FileId "{#LlmGoogleDriveFileId}"' +
    ' -DestinationRoot "' + ExpandConstant('{app}') + '"';

  LlmInstallPage.SetText(
    'Installing local AI runtime',
    'Downloading and extracting the mandatory ChatV2 Qwen runtime. This may take several minutes.'
  );
  LlmInstallPage.Show;
  try
    if not Exec(PowerShellPath(), Params, '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
      RaiseException('Unable to start the local AI runtime installer helper.');

    if ResultCode <> 0 then
      RaiseException(
        'Failed to install the mandatory local AI runtime. Check network access and try the installer again.'
      );
  finally
    LlmInstallPage.Hide;
  end;
end;

procedure InitializeWizard();
begin
  LlmInstallPage := CreateOutputProgressPage(
    'Installing local AI runtime',
    'Preparing the mandatory ChatV2 Qwen runtime.'
  );
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
    InstallMandatoryLlm();
end;
