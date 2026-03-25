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
Source: "..\stage\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "prereqs\*"
Source: "..\stage\prereqs\WindowsAppRuntimeInstall-x64.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall ignoreversion
Source: "download-llm-from-drive.ps1"; Flags: dontcopy

[Icons]
Name: "{autoprograms}\{#MyShortcutName}"; Filename: "{app}\{#MyExeName}"; WorkingDir: "{app}"; IconFilename: "{app}\runtime\branding\app.ico"
Name: "{autodesktop}\{#MyShortcutName}"; Filename: "{app}\{#MyExeName}"; WorkingDir: "{app}"; IconFilename: "{app}\runtime\branding\app.ico"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create desktop shortcuts"; GroupDescription: "Additional icons:"

[Code]
const
  WindowsAppRuntimeInstallerFileName = 'WindowsAppRuntimeInstall-x64.exe';
  LlmInstallStatusSection = 'progress';
  LlmInstallPollIntervalMs = 250;
  LlmInstallStartupTimeoutTicks = 120;
  LlmInstallTimeoutTicks = 14400;

function SetTimer(hWnd, nIDEvent, uElapse, lpTimerFunc: LongWord): LongWord;
  external 'SetTimer@user32.dll stdcall';
function KillTimer(hWnd, uIDEvent: LongWord): LongWord;
  external 'KillTimer@user32.dll stdcall';

var
  LlmInstallDialog: TSetupForm;
  LlmInstallSummaryLabel: TNewStaticText;
  LlmInstallDetailLabel: TNewStaticText;
  LlmInstallProgressBar: TNewProgressBar;
  LlmInstallStatusFile: string;
  LlmInstallTimerId: LongWord;
  LlmInstallCompleted: Boolean;
  LlmInstallSucceeded: Boolean;
  LlmInstallErrorMessage: string;
  LlmInstallPollTicks: Integer;

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

procedure InstallWindowsAppRuntime();
var
  InstallerPath: string;
  Params: string;
  ResultCode: Integer;
begin
  InstallerPath := ExpandConstant('{tmp}\' + WindowsAppRuntimeInstallerFileName);
  if not FileExists(InstallerPath) then
    RaiseException('The Windows App Runtime installer payload is missing from setup.');

  WizardForm.StatusLabel.Caption := 'Installing Windows App Runtime...';
  WizardForm.Update;

  Params := '--quiet --force';
  if not Exec(InstallerPath, Params, '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
    RaiseException('Unable to start the Windows App Runtime installer.');

  if ResultCode <> 0 then
    RaiseException(
      'Failed to install the required Windows App Runtime. Exit code: ' + IntToStr(ResultCode) + '.'
    );
end;

procedure LlmInstallDialogCloseQuery(Sender: TObject; var CanClose: Boolean);
begin
  CanClose := LlmInstallCompleted;
end;

procedure InitializeLlmInstallDialog();
begin
  if LlmInstallDialog <> nil then
    exit;

  LlmInstallDialog := CreateCustomForm(ScaleX(420), ScaleY(150), True, False);
  LlmInstallDialog.Caption := 'Installing local AI runtime';
  LlmInstallDialog.PopupParent := WizardForm;
  LlmInstallDialog.Position := poMainFormCenter;
  LlmInstallDialog.BorderIcons := [biSystemMenu, biMinimize];
  LlmInstallDialog.OnCloseQuery := @LlmInstallDialogCloseQuery;

  LlmInstallSummaryLabel := TNewStaticText.Create(LlmInstallDialog);
  LlmInstallSummaryLabel.Parent := LlmInstallDialog;
  LlmInstallSummaryLabel.Left := ScaleX(20);
  LlmInstallSummaryLabel.Top := ScaleY(20);
  LlmInstallSummaryLabel.Width := LlmInstallDialog.ClientWidth - ScaleX(40);
  LlmInstallSummaryLabel.Height := ScaleY(36);
  LlmInstallSummaryLabel.AutoSize := False;
  LlmInstallSummaryLabel.WordWrap := True;
  LlmInstallSummaryLabel.Font.Style := [fsBold];
  LlmInstallSummaryLabel.Caption := 'Preparing local AI runtime.';

  LlmInstallDetailLabel := TNewStaticText.Create(LlmInstallDialog);
  LlmInstallDetailLabel.Parent := LlmInstallDialog;
  LlmInstallDetailLabel.Left := LlmInstallSummaryLabel.Left;
  LlmInstallDetailLabel.Top := ScaleY(62);
  LlmInstallDetailLabel.Width := LlmInstallSummaryLabel.Width;
  LlmInstallDetailLabel.Height := ScaleY(40);
  LlmInstallDetailLabel.AutoSize := False;
  LlmInstallDetailLabel.WordWrap := True;
  LlmInstallDetailLabel.Caption := 'Setting up the required local AI files. This may take several minutes.';

  LlmInstallProgressBar := TNewProgressBar.Create(LlmInstallDialog);
  LlmInstallProgressBar.Parent := LlmInstallDialog;
  LlmInstallProgressBar.Left := LlmInstallSummaryLabel.Left;
  LlmInstallProgressBar.Top := ScaleY(112);
  LlmInstallProgressBar.Width := LlmInstallSummaryLabel.Width;
  LlmInstallProgressBar.Height := ScaleY(18);
  LlmInstallProgressBar.Style := npbstMarquee;
  LlmInstallProgressBar.State := npbsNormal;
  LlmInstallProgressBar.Visible := True;
end;

procedure LlmInstallTimerProc(H, Msg, IdEvent, Time: LongWord);
var
  State: string;
  Summary: string;
  Detail: string;
  ErrorMessage: string;
begin
  Inc(LlmInstallPollTicks);
  if LlmInstallPollTicks > LlmInstallTimeoutTicks then
  begin
    LlmInstallCompleted := True;
    LlmInstallSucceeded := False;
    LlmInstallErrorMessage :=
      'Timed out while installing the local AI runtime. Check network access and try the installer again.';
    LlmInstallDialog.Close;
    exit;
  end;

  if not FileExists(LlmInstallStatusFile) then
  begin
    if LlmInstallPollTicks > LlmInstallStartupTimeoutTicks then
    begin
      LlmInstallCompleted := True;
      LlmInstallSucceeded := False;
      LlmInstallErrorMessage := 'Unable to start the local AI runtime installer helper.';
      LlmInstallDialog.Close;
    end;
    exit;
  end;

  State := LowerCase(GetIniString(LlmInstallStatusSection, 'state', 'running', LlmInstallStatusFile));
  Summary := GetIniString(LlmInstallStatusSection, 'message', '', LlmInstallStatusFile);
  Detail := GetIniString(LlmInstallStatusSection, 'detail', '', LlmInstallStatusFile);
  ErrorMessage := GetIniString(LlmInstallStatusSection, 'error', '', LlmInstallStatusFile);

  if Summary <> '' then
    LlmInstallSummaryLabel.Caption := Summary;
  if Detail <> '' then
    LlmInstallDetailLabel.Caption := Detail;

  if State = 'completed' then
  begin
    LlmInstallCompleted := True;
    LlmInstallSucceeded := True;
    LlmInstallDialog.Close;
    exit;
  end;

  if State = 'failed' then
  begin
    LlmInstallCompleted := True;
    LlmInstallSucceeded := False;
    if ErrorMessage <> '' then
      LlmInstallErrorMessage := ErrorMessage
    else
      LlmInstallErrorMessage :=
        'Failed to install the mandatory local AI runtime. Check network access and try the installer again.';
    LlmInstallDialog.Close;
  end;
end;

procedure WaitForLlmInstallCompletion();
begin
  InitializeLlmInstallDialog();

  LlmInstallCompleted := False;
  LlmInstallSucceeded := False;
  LlmInstallErrorMessage := '';
  LlmInstallPollTicks := 0;
  LlmInstallSummaryLabel.Caption := 'Preparing local AI runtime.';
  LlmInstallDetailLabel.Caption := 'Setting up the required local AI files. This may take several minutes.';
  LlmInstallProgressBar.State := npbsNormal;

  LlmInstallTimerId := SetTimer(0, 0, LlmInstallPollIntervalMs, CreateCallback(@LlmInstallTimerProc));
  try
    LlmInstallDialog.ShowModal;
  finally
    if LlmInstallTimerId <> 0 then
    begin
      KillTimer(0, LlmInstallTimerId);
      LlmInstallTimerId := 0;
    end;
  end;

  if not LlmInstallSucceeded then
  begin
    if LlmInstallErrorMessage = '' then
      LlmInstallErrorMessage :=
        'Failed to install the mandatory local AI runtime. Check network access and try the installer again.';
    RaiseException(LlmInstallErrorMessage);
  end;
end;

procedure InstallMandatoryLlm();
var
  ScriptPath: string;
  DestinationRoot: string;
  Params: string;
  ResultCode: Integer;
begin
  if IsLlmInstalled() then
    exit;

  ExtractTemporaryFile('download-llm-from-drive.ps1');
  ScriptPath := ExpandConstant('{tmp}\download-llm-from-drive.ps1');
  DestinationRoot := ExpandConstant('{app}');
  LlmInstallStatusFile :=
    ExpandConstant('{tmp}\llm-install-status-' + GetDateTimeString('yyyymmddhhnnsszzz', #0, #0) + '.ini');
  Params :=
    '-NoProfile -ExecutionPolicy Bypass -File ' + AddQuotes(ScriptPath) +
    ' -FileId "{#LlmGoogleDriveFileId}"' +
    ' -DestinationRoot ' + AddQuotes(DestinationRoot) +
    ' -StatusFile ' + AddQuotes(LlmInstallStatusFile);

  if WizardSilent() then
  begin
    if not Exec(PowerShellPath(), Params, '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
      RaiseException('Unable to start the local AI runtime installer helper.');

    if ResultCode <> 0 then
      RaiseException(
        'Failed to install the mandatory local AI runtime. Check network access and try the installer again.'
      );
  end
  else
  begin
    if not Exec(PowerShellPath(), Params, '', SW_HIDE, ewNoWait, ResultCode) then
      RaiseException('Unable to start the local AI runtime installer helper.');
    WaitForLlmInstallCompletion();
  end;

  if not IsLlmInstalled() then
    RaiseException('The local AI runtime installer finished without provisioning the required files.');
end;

procedure InitializeWizard();
begin
  InitializeLlmInstallDialog();
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    InstallWindowsAppRuntime();
    InstallMandatoryLlm();
  end;
end;
