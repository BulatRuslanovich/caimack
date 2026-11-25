# SPDX-License-Identifier: AGPL-3.0-only
param(
    [ValidateSet('on', 'off', 'status')]
    [string]$Mode = 'status'
)

$ErrorActionPreference = 'Stop'
$taskName = 'Caimack Monitoring SSH'
$envFile = Join-Path $PSScriptRoot '.env'
$viewer = @('compose', '--project-name', 'caimack-monitoring', '--env-file', $envFile, '-f', (Join-Path $PSScriptRoot 'compose.yml'))
$sshTarget = ''
if (Test-Path -LiteralPath $envFile) {
    $targetLine = Get-Content -LiteralPath $envFile | Where-Object { $_ -match '^CAIMACK_MONITORING_SSH_TARGET=' } | Select-Object -Last 1
    if ($targetLine) {
        $sshTarget = ($targetLine -split '=', 2)[1].Trim().Trim('"', "'")
    }
}
if ($sshTarget -and $sshTarget -notmatch '^[\w][\w.-]*@[a-zA-Z0-9][a-zA-Z0-9.-]*$') {
    throw 'Set CAIMACK_MONITORING_SSH_TARGET to user@hostname or user@IPv4 in deploy/monitoring/.env.'
}
$exporter = @('--host', "ssh://$sshTarget", 'compose', '--project-name', 'caimack-monitoring-exporter', '-f', (Join-Path $PSScriptRoot 'exporter.compose.yml'))

function Invoke-MonitorDocker {
    & docker @args
    if ($LASTEXITCODE -ne 0) {
        throw "Docker exited with code $LASTEXITCODE."
    }
}

function Start-MetricsTunnel {
    $task = Get-ScheduledTask -TaskPath '\' -TaskName $taskName -ErrorAction SilentlyContinue
    $taskArgs = '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -Command "& ssh.exe -NT -o BatchMode=yes -o StrictHostKeyChecking=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -L 127.0.0.1:19100:127.0.0.1:19100 {0}; exit $LASTEXITCODE"' -f $sshTarget
    if (!$task -or $task.Actions.Count -ne 1 -or $task.Actions[0].Arguments -ne $taskArgs) {
        if ($task -and $task.State -eq 'Running') {
            Stop-ScheduledTask -InputObject $task
        }
        $taskUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
        $action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument $taskArgs
        $trigger = New-ScheduledTaskTrigger -AtLogOn -User $taskUser
        $principal = New-ScheduledTaskPrincipal -UserId $taskUser -LogonType Interactive
        $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
            -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartInterval (New-TimeSpan -Minutes 1) -RestartCount 999 -StartWhenAvailable
        $task = Register-ScheduledTask -TaskPath '\' -TaskName $taskName -Action $action -Trigger $trigger `
            -Principal $principal -Settings $settings -Description 'Forwards the Caimack Node Exporter port over SSH.' -Force
    }
    if ($task.State -eq 'Disabled') {
        $task = Enable-ScheduledTask -InputObject $task
    }
    if ($task.State -ne 'Running') {
        Start-ScheduledTask -InputObject $task
    }
    for ($attempt = 0; $attempt -lt 10; $attempt++) {
        $listener = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 19100 -State Listen -ErrorAction SilentlyContinue
        if ($listener -and (Get-ScheduledTask -TaskPath '\' -TaskName $taskName).State -eq 'Running') {
            return
        }
        Start-Sleep -Seconds 1
    }
    throw "SSH forwarding did not start. Check key authentication with ssh $sshTarget and port 19100."
}

function Stop-MetricsTunnel {
    $task = Get-ScheduledTask -TaskPath '\' -TaskName $taskName -ErrorAction SilentlyContinue
    if ($task) {
        Disable-ScheduledTask -InputObject $task | Out-Null
        if ($task.State -eq 'Running') {
            Stop-ScheduledTask -InputObject $task
        }
    }
}

switch ($Mode) {
    on {
        if (!$sshTarget) {
            throw 'Set CAIMACK_MONITORING_SSH_TARGET in deploy/monitoring/.env. See the monitoring README.'
        }
        Invoke-MonitorDocker @viewer config --quiet
        Invoke-MonitorDocker @exporter up -d --wait --wait-timeout 60
        Start-MetricsTunnel
        Invoke-MonitorDocker @viewer up -d --wait --wait-timeout 60
        Write-Host 'Monitoring enabled.'
    }
    off {
        $steps = @(
            {
                $containers = @(Invoke-MonitorDocker ps --quiet --filter 'label=com.docker.compose.project=caimack-monitoring')
                if ($containers) { Invoke-MonitorDocker stop @containers }
            },
            { Stop-MetricsTunnel },
            { if ($sshTarget) { Invoke-MonitorDocker @exporter stop } }
        )
        $failed = $false
        foreach ($step in $steps) {
            try { & $step } catch { Write-Warning $_.Exception.Message; $failed = $true }
        }
        if ($failed) { throw 'Some monitoring components could not be stopped. Run monitoring status and retry.' }
        if (!$sshTarget) { Write-Warning 'Set the SSH target to manage the Linux exporter from this PC.' }
        Write-Host 'Monitoring stopped. Grafana and Prometheus data preserved.'
    }
    status {
        Write-Host 'Windows monitoring stack'
        Invoke-MonitorDocker ps --all --filter 'label=com.docker.compose.project=caimack-monitoring' --format 'table {{.Names}}\t{{.Status}}'
        $task = Get-ScheduledTask -TaskPath '\' -TaskName $taskName -ErrorAction SilentlyContinue
        if ($task) { Write-Host "SSH forwarding task: $($task.State)" } else { Write-Host 'SSH forwarding task: not configured' }
        if ($sshTarget) {
            Write-Host 'Linux metrics exporter'
            Invoke-MonitorDocker @exporter ps --all
        }
    }
}
