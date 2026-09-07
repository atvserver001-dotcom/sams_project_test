param(
  [switch]$ReadOnly
)

# Try to load missing env vars from .env.local at repo root
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$envFile  = Join-Path $repoRoot ".env.local"

if (-not $env:SUPABASE_PROJECT_REF -or -not $env:SUPABASE_ACCESS_TOKEN) {
  if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
      $line = $_.Trim()
      if (-not [string]::IsNullOrWhiteSpace($line) -and -not $line.StartsWith('#')) {
        $parts = $line -split '=', 2
        if ($parts.Count -eq 2) {
          $k = $parts[0].Trim()
          $v = $parts[1].Trim().Trim('"')
          if (-not [string]::IsNullOrWhiteSpace($k)) {
            [Environment]::SetEnvironmentVariable($k, $v, 'Process') | Out-Null
          }
        }
      }
    }
  }
}

if (-not $env:SUPABASE_PROJECT_REF) { Write-Error "SUPABASE_PROJECT_REF is missing"; exit 1 }
if (-not $env:SUPABASE_ACCESS_TOKEN) { Write-Error "SUPABASE_ACCESS_TOKEN is missing"; exit 1 }

$argsList = @()
if ($ReadOnly) { $argsList += "--read-only" }
$argsList += @("--project-ref", $env:SUPABASE_PROJECT_REF)

$exe = "node"
$entry = Join-Path $PSScriptRoot "..\node_modules\@supabase\mcp-server-supabase\dist\transports\stdio.js"

Write-Host "Launching MCP server..."
Write-Host "Command: $exe $entry $($argsList -join ' ')"

$argListCombined = @($entry) + $argsList
$process = Start-Process -FilePath $exe -ArgumentList $argListCombined -NoNewWindow -PassThru -RedirectStandardOutput "$PSScriptRoot\mcp.out.log" -RedirectStandardError "$PSScriptRoot\mcp.err.log"

Start-Sleep -Seconds 2

if ($process.HasExited) {
  Write-Error "MCP process exited with code $($process.ExitCode)"
  Get-Content "$PSScriptRoot\mcp.err.log" -ErrorAction SilentlyContinue | Write-Output
  exit $process.ExitCode
}

Write-Host "MCP seems running (PID=$($process.Id)). Stopping..."
Stop-Process -Id $process.Id -Force
Write-Host "Stopped. Logs:"
Get-Content "$PSScriptRoot\mcp.out.log" -ErrorAction SilentlyContinue | Write-Output
Get-Content "$PSScriptRoot\mcp.err.log" -ErrorAction SilentlyContinue | Write-Output

exit 0


