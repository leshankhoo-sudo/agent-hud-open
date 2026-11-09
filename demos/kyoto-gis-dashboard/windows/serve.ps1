# Kyoto Prefecture Tourism GIS - local web server for Windows (no install needed).
# Serves the "site" folder at http://localhost:8765/ using Windows PowerShell 5.1+.
$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'site'))
if (-not (Test-Path (Join-Path $root 'index.html'))) {
  Write-Host "The 'site' folder was not found next to this script. Unzip the whole ZIP first, then run Start-Dashboard.bat again."
  Read-Host 'Press Enter to close'
  exit 1
}
$listener = $null
$port = 0
foreach ($p in 8765..8775) {
  $l = New-Object System.Net.HttpListener
  $l.Prefixes.Add("http://localhost:$p/")
  try { $l.Start(); $listener = $l; $port = $p; break } catch { $l.Close() }
}
if ($null -eq $listener) {
  Write-Host 'Could not open a local port between 8765 and 8775.'
  Read-Host 'Press Enter to close'
  exit 1
}
$url = "http://localhost:$port/"
Write-Host ''
Write-Host '  Kyoto Prefecture Tourism GIS is running.'
Write-Host "  Address: $url"
Write-Host '  Keep this window open while you use the dashboard.'
Write-Host '  Close this window to stop it.'
Write-Host ''
Start-Process $url
$types = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'; '.geojson' = 'application/geo+json; charset=utf-8'; '.csv' = 'text/csv; charset=utf-8'
  '.woff2' = 'font/woff2'; '.woff' = 'font/woff'; '.svg' = 'image/svg+xml'; '.png' = 'image/png'; '.ico' = 'image/x-icon'
}
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $res = $ctx.Response
  try {
    $rel = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
    if ($rel -eq '') { $rel = 'index.html' }
    $path = [System.IO.Path]::GetFullPath((Join-Path $root $rel))
    if ((-not $path.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) -or (-not (Test-Path -LiteralPath $path -PathType Leaf))) {
      $res.StatusCode = 404
      $b = [System.Text.Encoding]::UTF8.GetBytes('Not found')
      $res.OutputStream.Write($b, 0, $b.Length)
    } else {
      $ext = [System.IO.Path]::GetExtension($path).ToLower()
      if ($types.ContainsKey($ext)) { $res.ContentType = $types[$ext] } else { $res.ContentType = 'application/octet-stream' }
      $bytes = [System.IO.File]::ReadAllBytes($path)
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    }
  } catch {
    try { $res.StatusCode = 500 } catch { }
  } finally {
    $res.OutputStream.Close()
  }
}
