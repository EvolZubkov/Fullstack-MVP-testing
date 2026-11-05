<#
.SYNOPSIS
    Create or remove the worktree of one task of «Сценарий в ИС» P1 «Модель v2».

.DESCRIPTION
    Paths and branches come from scripts/sim/v2/tasks.json, so the coordinator types only a task id.

    -New creates the worktree from the wave start tag sim-v2-w<N>-start, links node_modules to the
    main copy with a junction and copies .env.

    -Remove refuses unless the task branch is merged into the integration branch. It removes the
    node_modules junction with `cmd /c rmdir` BEFORE `git worktree remove`: PowerShell 5.1
    `Remove-Item` asks for confirmation on a junction in a non-interactive shell, and
    `git worktree remove` walks INTO a junction and deletes files of the main copy's node_modules.

    Tasks that run in the integration worktree itself (W0, W5) have no worktree of their own.

.PARAMETER New
    Task id to create the worktree for.

.PARAMETER Remove
    Task id to remove the worktree of.

.EXAMPLE
    powershell -NoProfile -File C:\Repositories\test-builder-sim-editor\scripts\sim\v2\worktree.ps1 -New W1-engine
#>
[CmdletBinding()]
param([string]$New, [string]$Remove)

$ErrorActionPreference = 'Continue'
Set-StrictMode -Version 2

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Manifest = Get-Content -Raw -Encoding UTF8 (Join-Path $ScriptDir 'tasks.json') | ConvertFrom-Json
$Integration = $Manifest.integration.worktree
$IntegrationBranch = $Manifest.integration.branch
$MainModules = 'C:\Repositories\test-builder\node_modules'
$MainEnv = 'C:\Repositories\test-builder\.env'

function Stop-With([string]$Message) { Write-Host "ERROR: $Message"; exit 1 }

if (($New -and $Remove) -or (-not $New -and -not $Remove)) { Stop-With 'Give exactly one of -New <id> or -Remove <id>.' }
$id = if ($New) { $New } else { $Remove }
$task = @($Manifest.tasks | Where-Object { $_.id -eq $id })
if ($task.Count -ne 1) { Stop-With "Unknown task $id" }
$task = $task[0]
$path = $task.worktree.Replace('/', '\')
if ($path -eq $Integration.Replace('/', '\')) { Stop-With "$id works in the integration worktree itself; there is nothing to create or remove." }
$branch = $task.branch
$tag = "sim-v2-w$($task.wave)-start"

if ($New) {
    & git -C $Integration rev-parse --verify --quiet "$tag^{commit}" | Out-Null
    if ($LASTEXITCODE -ne 0) { Stop-With "Tag $tag is not set. Set it first: git -C $Integration tag $tag $IntegrationBranch" }
    if (Test-Path $path) { Stop-With "$path already exists" }
    & git -C $Integration worktree add $path -b $branch $tag
    if ($LASTEXITCODE -ne 0) { Stop-With 'git worktree add failed' }
    & cmd /c mklink /J "$path\node_modules" "$MainModules" | Out-Null
    if (-not (Test-Path "$path\node_modules\.bin")) { Stop-With 'node_modules junction was not created' }
    Copy-Item $MainEnv "$path\.env"
    Write-Host "Created $path on branch $branch from $tag (node_modules junction, .env copied)"
    exit 0
}

# -Remove
$merged = @(& git -C $Integration branch --merged $IntegrationBranch --format='%(refname:short)')
if ($merged -notcontains $branch) { Stop-With "Branch $branch is not merged into $IntegrationBranch; refusing to remove it." }
if (Test-Path "$path\node_modules") {
    $item = Get-Item "$path\node_modules" -Force
    if ($item.LinkType -ne 'Junction') { Stop-With "$path\node_modules is not a junction; remove it by hand after checking" }
    & cmd /c rmdir "$path\node_modules"
    if (Test-Path "$path\node_modules") { Stop-With 'node_modules junction is still there; not removing the worktree' }
}
& git -C $Integration worktree remove --force $path
& git -C $Integration worktree prune
& git -C $Integration branch -d $branch
if (Test-Path $path) { Write-Host "Note: directory $path is left on disk (no node_modules inside); it can be deleted." }
if (-not (Test-Path "$MainModules\.bin")) { Stop-With "Main node_modules looks damaged: $MainModules\.bin is missing. Run npm ci in C:\Repositories\test-builder." }
Write-Host "Removed $path and branch $branch; main node_modules intact"
exit 0
