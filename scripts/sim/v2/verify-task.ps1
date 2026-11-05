<#
.SYNOPSIS
    Mechanical acceptance of one task or one merged wave of «Сценарий в ИС» P1 «Модель v2».

.DESCRIPTION
    Trusts nothing a session reports: every verdict comes from git, tsc, vitest and the package
    build run here. The rules come from scripts/sim/v2/tasks.json; the plan is
    docs/plans/PLAN_sim_v2_model.md, the coordination docs/plans/COORD_sim_v2_model.md.

    Checks, each reported PASS or FAIL:
      1. clean      - nothing uncommitted in the checked worktree;
      2. trailer    - no commit of the range carries a Co-Authored-By trailer;
      3. scope      - every changed file is allowed for the task (or the wave) and none is forbidden;
      4. tests-kept - no test file deleted or renamed; no added .skip/.only/.todo/.fails/x-it;
                      an existing test file changes only when the manifest allows it, its added
                      lines match the allowed pattern, and it keeps at least as many expect( calls;
      5. new-tests  - every test file the task must create exists;
      6. docs       - markdownlint and JSON parsing of the documents the task owns;
      7. tsc        - no type errors in the task's own files; in wave mode, none at all when the
                      wave requires a clean project;
      8. vitest     - the task's tests and every regression and earlier new test pass, run here;
      9. package    - the sample SCORM package is byte-identical to the baseline taken before wave 0,
                      except the TBTemplate bundle of shared code at the head of app.js: legitimate
                      shared/sim changes land there, and the scope check guards which are allowed. The
                      rest of app.js (the package runtime) and every other entry are compared.

    The range checked is <wave start tag>..HEAD, the tag being sim-v2-w<N>-start, set by the
    coordinator on the integration branch before the wave. The baseline of the package is read
    from that tag of wave 0, so no branch can change what it is compared with.

.PARAMETER Task
    Task id from the manifest: W0, W1-engine, W1-optimum, W1-docs, W2-routes, W2-player,
    W3-validate, W4-server, W4-client, W5.

.PARAMETER Wave
    Check the integration worktree after every task of the wave is merged.

.PARAMETER Baseline
    Record the package baseline: builds the sample package twice, requires identical builds and
    writes tests/fixtures/sim/scorm-sample-hashes.json in the integration worktree. Once, before
    wave 0.

.PARAMETER SkipTests
    Skip vitest (for a quick look at scope only). A run with it can never end in PASS.

.PARAMETER SkipPackage
    Skip the package build. A run with it can never end in PASS.

.EXAMPLE
    powershell -NoProfile -File C:\Repositories\test-builder-sim-editor\scripts\sim\v2\verify-task.ps1 -Task W1-engine

.EXAMPLE
    powershell -NoProfile -File C:\Repositories\test-builder-sim-editor\scripts\sim\v2\verify-task.ps1 -Wave 1
#>
[CmdletBinding()]
param(
    [string]$Task,
    [int]$Wave = -1,
    [switch]$Baseline,
    [switch]$SkipTests,
    [switch]$SkipPackage
)

$ErrorActionPreference = 'Continue'
Set-StrictMode -Version 2

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Manifest = Get-Content -Raw -Encoding UTF8 (Join-Path $ScriptDir 'tasks.json') | ConvertFrom-Json
$Integration = $Manifest.integration.worktree
$BaselinePath = 'tests/fixtures/sim/scorm-sample-hashes.json'
$Results = New-Object System.Collections.Generic.List[object]
$Incomplete = $false

function Add-Result([string]$Check, [bool]$Ok, [string]$Detail) {
    $Results.Add([pscustomobject]@{ Check = $Check; Ok = $Ok; Detail = $Detail })
    if ($Ok) { $mark = 'PASS' } else { $mark = 'FAIL' }
    Write-Host ("[{0}] {1}: {2}" -f $mark, $Check, $Detail)
}

function Invoke-Git([string]$Root, [string[]]$GitArgs) {
    $out = & git -C $Root @GitArgs 2>$null
    if ($LASTEXITCODE -ne 0) { throw "git $($GitArgs -join ' ') failed in $Root" }
    return @($out)
}

function Test-Like([string]$Path, [object[]]$Patterns) {
    foreach ($p in $Patterns) { if ($Path -like $p) { return $true } }
    return $false
}

function Test-IsTestFile([string]$Path) {
    return ($Path -like 'tests/*') -or ($Path -like '*__tests__*') -or ($Path -like '*.test.ts') -or ($Path -like '*.test.tsx')
}

function Get-PackageHashes([string]$Root) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $ident = Join-Path $Root 'uploads/scorm/identifiers.json'
    $saved = $null
    if (Test-Path $ident) { $saved = [System.IO.File]::ReadAllBytes($ident) }
    Push-Location $Root
    try {
        & cmd /c "npm run scorm:sample > `"%TEMP%\sim-v2-scorm.log`" 2>&1"
        if ($LASTEXITCODE -ne 0) { throw 'npm run scorm:sample failed, see %TEMP%\sim-v2-scorm.log' }
    } finally {
        Pop-Location
        if ($null -ne $saved) { [System.IO.File]::WriteAllBytes($ident, $saved) }
    }
    $zipPath = Join-Path $Root 'out/sample-default-template.zip'
    $zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
    $hashes = [ordered]@{}
    try {
        $sha = [System.Security.Cryptography.SHA256]::Create()
        foreach ($e in ($zip.Entries | Sort-Object FullName)) {
            if ($e.FullName.EndsWith('/')) { continue }
            if ($e.FullName -eq 'app.js') {
                # app.js opens with the TBTemplate bundle of shared code: every legitimate change to
                # shared/sim changes it, and which shared files a task may touch is the scope check's
                # job. The rest of app.js is the package runtime and is compared byte for byte.
                $reader = New-Object System.IO.StreamReader($e.Open(), [System.Text.Encoding]::UTF8)
                try { $text = $reader.ReadToEnd() } finally { $reader.Dispose() }
                $end = [regex]::Match($text, 'return __toCommonJS\(runtime_entry_exports\);\r?\n\}\)\(\);')
                if (-not $text.StartsWith('"use strict";') -or -not $end.Success) { throw 'app.js: TBTemplate bundle boundary not found' }
                $cut = $end.Index + $end.Length
                $utf8 = New-Object System.Text.UTF8Encoding $false
                $hashes['app.js#runtime'] = [BitConverter]::ToString($sha.ComputeHash($utf8.GetBytes($text.Substring($cut)))).Replace('-', '')
                $hashes['app.js#bundle'] = [BitConverter]::ToString($sha.ComputeHash($utf8.GetBytes($text.Substring(0, $cut)))).Replace('-', '')
                continue
            }
            $s = $e.Open()
            try { $hashes[$e.FullName] = [BitConverter]::ToString($sha.ComputeHash($s)).Replace('-', '') } finally { $s.Dispose() }
        }
    } finally { $zip.Dispose() }
    return $hashes
}

# ── Baseline mode ─────────────────────────────────────────────────────────────
if ($Baseline) {
    $first = Get-PackageHashes $Integration
    $second = Get-PackageHashes $Integration
    $differs = @($first.Keys | Where-Object { $first[$_] -ne $second[$_] })
    if ($differs.Count -gt 0) {
        Write-Host "Two builds differ in: $($differs -join ', '). The package is not deterministic; no baseline written."
        exit 1
    }
    $commit = @(Invoke-Git $Integration @('rev-parse', 'HEAD'))[0]
    $doc = [ordered]@{ commit = $commit; package = 'out/sample-default-template.zip'; entries = $first }
    $json = $doc | ConvertTo-Json -Depth 4
    $target = Join-Path $Integration $BaselinePath
    $null = New-Item -ItemType Directory -Force (Split-Path -Parent $target)
    [System.IO.File]::WriteAllText($target, $json + "`n", (New-Object System.Text.UTF8Encoding $false))
    Write-Host "Baseline written: $($first.Count) entries, commit $commit"
    exit 0
}

# ── What is checked ──────────────────────────────────────────────────────────
if (($Task -and $Wave -ge 0) -or (-not $Task -and $Wave -lt 0)) {
    Write-Host 'Give exactly one of -Task <id> or -Wave <n> (or -Baseline).'
    exit 2
}

$allTasks = @($Manifest.tasks)
if ($Task) {
    $own = @($allTasks | Where-Object { $_.id -eq $Task })
    if ($own.Count -ne 1) { Write-Host "Unknown task $Task"; exit 2 }
    $waveNo = [int]$own[0].wave
    $Root = $own[0].worktree
    $scopeTasks = $own
    $label = "task $Task"
} else {
    $waveNo = $Wave
    $Root = $Integration
    $scopeTasks = @($allTasks | Where-Object { [int]$_.wave -eq $Wave })
    if ($scopeTasks.Count -eq 0) { Write-Host "No tasks in wave $Wave"; exit 2 }
    $label = "wave $Wave"
}
$Tag = "sim-v2-w$waveNo-start"

if (-not (Test-Path $Root)) { Write-Host "Worktree $Root does not exist"; exit 2 }
try { $null = Invoke-Git $Root @('rev-parse', '--verify', "$Tag^{commit}") } catch { Write-Host "Tag $Tag not found: the coordinator sets it before the wave"; exit 2 }
# The range starts at the common ancestor of the tag and HEAD, not at the tag itself: a fix of the
# plan or the manifest committed on the integration branch after the task branched moves the tag
# forward, and a plain tag..HEAD tree diff would show that fix reversed as the task's own change.
$Base = @(Invoke-Git $Root @('merge-base', $Tag, 'HEAD'))[0]
Write-Host "Checking $label in $Root, range $Tag ($($Base.Substring(0, 8)))..HEAD"

# ── 1. clean ─────────────────────────────────────────────────────────────────
$dirty = @(Invoke-Git $Root @('status', '--porcelain') | Where-Object { $_ })
Add-Result 'clean' ($dirty.Count -eq 0) ($(if ($dirty.Count) { "uncommitted: $($dirty -join '; ')" } else { 'nothing uncommitted' }))

# ── 2. trailer ───────────────────────────────────────────────────────────────
$bodies = (Invoke-Git $Root @('log', '--format=%B', "$Base..HEAD")) -join "`n"
$commits = @(Invoke-Git $Root @('rev-list', "$Base..HEAD")).Count
Add-Result 'trailer' (-not ($bodies -match '(?im)^\s*Co-Authored-By:')) "$commits commits in range"

# ── 3. scope ─────────────────────────────────────────────────────────────────
$allowed = @($scopeTasks | ForEach-Object { $_.allowed } | ForEach-Object { $_ })
$forbidden = @($Manifest.forbidden)
$status = @(Invoke-Git $Root @('diff', '--name-status', '-M', $Base, 'HEAD') | Where-Object { $_ })
$changes = @()
foreach ($line in $status) {
    $parts = $line -split "`t"
    $code = $parts[0].Substring(0, 1)
    $path = $parts[$parts.Count - 1]
    $changes += [pscustomobject]@{ Code = $code; Path = $path; From = $parts[1] }
}
# Wave mode: the integration branch also carries plan and harness fixes made after the wave tag. A
# task branch may never touch them — the task check enforces that before the merge — so here they
# are left out of the scope rules rather than reported as the wave's own changes.
$scoped = $changes
if (-not $Task) {
    $harness = @($Manifest.harness)
    $scoped = @($changes | Where-Object { -not (Test-Like $_.Path $harness) })
}
$outOfScope = @($scoped | Where-Object { -not (Test-Like $_.Path $allowed) } | ForEach-Object { $_.Path })
$touchedForbidden = @($scoped | Where-Object { Test-Like $_.Path $forbidden } | ForEach-Object { $_.Path })
$scopeOk = ($outOfScope.Count -eq 0) -and ($touchedForbidden.Count -eq 0)
$scopeDetail = "$($changes.Count) files changed"
if ($outOfScope.Count) { $scopeDetail += "; not allowed: $($outOfScope -join ', ')" }
if ($touchedForbidden.Count) { $scopeDetail += "; forbidden: $($touchedForbidden -join ', ')" }
Add-Result 'scope' $scopeOk $scopeDetail

# ── 4. tests-kept ────────────────────────────────────────────────────────────
$modifiedAllowed = @{}
foreach ($t in $scopeTasks) {
    foreach ($p in $t.modifiedTests.PSObject.Properties) { $modifiedAllowed[$p.Name] = $p.Value }
}
$weakening = '^\+(?!\+\+).*(\.(skip|only|todo)\s*\(|\b(it|test|describe)\.(fails|skipIf|runIf)\b|\bx(it|describe|test)\s*\()'
$problems = @()
foreach ($c in ($changes | Where-Object { Test-IsTestFile $_.Path })) {
    if ($c.Code -eq 'D' -or $c.Code -eq 'R') { $problems += "$($c.From): deleted or renamed"; continue }
    $diff = @(Invoke-Git $Root @('diff', '-U0', $Base, 'HEAD', '--', $c.Path))
    $added = @($diff | Where-Object { $_ -match '^\+(?!\+\+)' })
    foreach ($l in $added) { if ($l -match $weakening) { $problems += "$($c.Path): weakening line '$($l.Trim())'" } }
    if ($c.Code -eq 'M') {
        if (-not $modifiedAllowed.ContainsKey($c.Path)) { $problems += "$($c.Path): existing test changed without permission"; continue }
        $pattern = $modifiedAllowed[$c.Path]
        if ($null -ne $pattern) {
            foreach ($l in $added) {
                $text = $l.Substring(1)
                if ($text.Trim() -and -not ($text -match $pattern)) { $problems += "$($c.Path): added line outside the allowed edit '$($text.Trim())'" }
            }
        }
        $before = ((Invoke-Git $Root @('show', "${Base}:$($c.Path)")) -join "`n")
        $after = Get-Content -Raw -Encoding UTF8 (Join-Path $Root $c.Path)
        $nBefore = ([regex]::Matches($before, 'expect\(')).Count
        $nAfter = ([regex]::Matches($after, 'expect\(')).Count
        if ($nAfter -lt $nBefore) { $problems += "$($c.Path): expect( calls $nBefore -> $nAfter" }
    }
}
Add-Result 'tests-kept' ($problems.Count -eq 0) ($(if ($problems.Count) { $problems -join ' | ' } else { 'no test weakened' }))

# ── 5. new-tests ─────────────────────────────────────────────────────────────
$mustCreate = @($scopeTasks | ForEach-Object { $_.newTests } | ForEach-Object { $_ })
$missing = @($mustCreate | Where-Object { -not (Test-Path (Join-Path $Root $_)) })
# A new test file is the plan's: it may grow, never shrink below the plan's own count of tests
# and expect( calls (manifest "minCounts").
$short = @()
foreach ($t in $scopeTasks) {
    if (-not $t.PSObject.Properties['minCounts']) { continue }
    foreach ($p in $t.minCounts.PSObject.Properties) {
        $file = Join-Path $Root $p.Name
        if (-not (Test-Path $file)) { continue }
        $body = Get-Content -Raw -Encoding UTF8 $file
        $nIt = ([regex]::Matches($body, '\bit\(')).Count
        $nExpect = ([regex]::Matches($body, 'expect\(')).Count
        if ($nIt -lt [int]$p.Value.it) { $short += "$($p.Name): it( $nIt < $($p.Value.it)" }
        if ($nExpect -lt [int]$p.Value.expect) { $short += "$($p.Name): expect( $nExpect < $($p.Value.expect)" }
    }
}
$newOk = ($missing.Count -eq 0) -and ($short.Count -eq 0)
$newDetail = "$($mustCreate.Count) present"
if ($missing.Count) { $newDetail = "missing: $($missing -join ', ')" }
if ($short.Count) { $newDetail += "; below the plan: $($short -join ', ')" }
Add-Result 'new-tests' $newOk $newDetail

# ── 6. docs ──────────────────────────────────────────────────────────────────
$md = @($scopeTasks | ForEach-Object { if ($_.PSObject.Properties['markdown']) { $_.markdown } } | ForEach-Object { $_ })
$js = @($scopeTasks | ForEach-Object { if ($_.PSObject.Properties['json']) { $_.json } } | ForEach-Object { $_ })
if ($md.Count -or $js.Count) {
    $docProblems = @()
    if ($md.Count) {
        Push-Location $Root
        $lint = & cmd /c "node_modules\.bin\markdownlint-cli2.cmd $($md -join ' ') 2>&1"
        $lintCode = $LASTEXITCODE
        Pop-Location
        if ($lintCode -ne 0) { $docProblems += 'markdownlint: ' + (($lint | Select-Object -Last 5) -join ' / ') }
    }
    foreach ($f in $js) {
        try { $null = Get-Content -Raw -Encoding UTF8 (Join-Path $Root $f) | ConvertFrom-Json } catch { $docProblems += "${f}: not JSON" }
    }
    Add-Result 'docs' ($docProblems.Count -eq 0) ($(if ($docProblems.Count) { $docProblems -join ' | ' } else { "$($md.Count) markdown, $($js.Count) JSON ok" }))
}

# ── 7. tsc ───────────────────────────────────────────────────────────────────
Push-Location $Root
$tscOut = & cmd /c "npx tsc --noEmit --incremental false 2>&1"
Pop-Location
$errorFiles = @($tscOut | ForEach-Object { if ($_ -match '^(?<f>[^\(\s][^\(]*)\(\d+,\d+\): error TS') { $Matches['f'].Replace('\', '/') } })
$ownFiles = @()
foreach ($t in $scopeTasks) {
    foreach ($o in $t.tscOwn) {
        if ($o -eq 'changed') {
            $ownFiles += @($changes | Where-Object { $_.Code -ne 'D' -and ($_.Path -like '*.ts' -or $_.Path -like '*.tsx') -and -not (Test-IsTestFile $_.Path) -and ($_.Path -like 'shared/*' -or $_.Path -like 'server/*' -or $_.Path -like 'client/*') } | ForEach-Object { $_.Path })
        } else { $ownFiles += $o }
    }
}
$ownErrors = @($errorFiles | Where-Object { $ownFiles -contains $_ } | Sort-Object -Unique)
$waveRule = @($Manifest.waves | Where-Object { [int]$_.n -eq $waveNo })
$mustBeClean = (-not $Task) -and $waveRule.Count -eq 1 -and [bool]$waveRule[0].tscClean
$tscOk = ($ownErrors.Count -eq 0) -and (-not $mustBeClean -or $errorFiles.Count -eq 0)
$tscDetail = "$($errorFiles.Count) errors in $(@($errorFiles | Sort-Object -Unique).Count) files; own files with errors: $($ownErrors.Count)"
if ($ownErrors.Count) { $tscDetail += " ($($ownErrors -join ', '))" }
if ($mustBeClean) { $tscDetail += '; wave requires a clean project' }
Add-Result 'tsc' $tscOk $tscDetail

# ── 8. vitest ────────────────────────────────────────────────────────────────
if ($SkipTests) {
    $Incomplete = $true
    Write-Host '[SKIP] vitest'
} else {
    $earlier = @($allTasks | Where-Object { [int]$_.wave -lt $waveNo } | ForEach-Object { $_.newTests } | ForEach-Object { $_ })
    $mine = @($scopeTasks | ForEach-Object { $_.newTests; $_.extraTests } | ForEach-Object { $_ })
    $paths = @(@($Manifest.regressionTests) + $earlier + $mine | Where-Object { $_ } | Sort-Object -Unique)
    $report = Join-Path $env:TEMP ("sim-v2-vitest-{0}.json" -f ([guid]::NewGuid().ToString('N')))
    Push-Location $Root
    & cmd /c "npm test -- $($paths -join ' ') --reporter=json --outputFile=`"$report`" > `"%TEMP%\sim-v2-vitest.log`" 2>&1"
    Pop-Location
    if (-not (Test-Path $report)) {
        Add-Result 'vitest' $false 'no report written, see %TEMP%\sim-v2-vitest.log'
    } else {
        $r = Get-Content -Raw -Encoding UTF8 $report | ConvertFrom-Json
        [System.IO.File]::Delete($report)
        $names = @($r.testResults | ForEach-Object { $_.name.Replace('\', '/') })
        $unrun = @($paths | Where-Object { $p = $_; -not ($names | Where-Object { $_ -like "*$p*" }) })
        $failedFiles = @($r.testResults | Where-Object { $_.status -ne 'passed' } | ForEach-Object { $_.name.Replace('\', '/') -replace '^.*?/(tests|server|client|shared)/', '$1/' })
        $vOk = ($r.numFailedTests -eq 0) -and ($failedFiles.Count -eq 0) -and ($unrun.Count -eq 0) -and ($r.numTotalTests -gt 0)
        $vDetail = "$($r.numPassedTests)/$($r.numTotalTests) tests in $(@($r.testResults).Count) files"
        if ($failedFiles.Count) { $vDetail += "; failed: $($failedFiles -join ', ')" }
        if ($unrun.Count) { $vDetail += "; not run: $($unrun -join ', ')" }
        Add-Result 'vitest' $vOk $vDetail
    }
}

# ── 9. package ───────────────────────────────────────────────────────────────
if ($SkipPackage) {
    $Incomplete = $true
    Write-Host '[SKIP] package'
} else {
    try {
        $baseJson = (Invoke-Git $Integration @('show', "sim-v2-w0-start:$BaselinePath")) -join "`n"
        $expected = ($baseJson | ConvertFrom-Json).entries
        $actual = Get-PackageHashes $Root
        $names = @($expected.PSObject.Properties | ForEach-Object { $_.Name })
        $names = @($names | Where-Object { $_ -ne 'app.js#bundle' })
        $diffs = @()
        foreach ($n in $names) { if ($actual[$n] -ne $expected.$n) { $diffs += $n } }
        foreach ($n in $actual.Keys) { if ($n -ne 'app.js#bundle' -and $names -notcontains $n) { $diffs += "$n (new)" } }
        $bundleNote = if ($actual['app.js#bundle'] -eq $expected.'app.js#bundle') { 'shared bundle unchanged' } else { 'shared bundle changed, not compared' }
        Add-Result 'package' ($diffs.Count -eq 0) ($(if ($diffs.Count) { "differs: $($diffs -join ', ')" } else { "$($names.Count) entries identical to baseline; $bundleNote" }))
    } catch {
        Add-Result 'package' $false $_.Exception.Message
    }
}

# ── Verdict ──────────────────────────────────────────────────────────────────
$failed = @($Results | Where-Object { -not $_.Ok })
if ($failed.Count -eq 0 -and -not $Incomplete) {
    Write-Host "RESULT: PASS ($label)"
    exit 0
}
if ($failed.Count -eq 0) {
    Write-Host "RESULT: INCOMPLETE ($label) - checks were skipped, this is not a PASS"
    exit 1
}
Write-Host "RESULT: FAIL ($label) - $($failed.Count) of $($Results.Count) checks: $(($failed | ForEach-Object { $_.Check }) -join ', ')"
exit 1
