$Port = 8771
$Root = $PSScriptRoot
$Prefix = "http://localhost:$Port/"
$PostsFile = Join-Path $Root "posts.json"

function Send-Response($response, $statusCode, $body, $contentType) {
  $response.StatusCode = $statusCode
  $response.ContentType = $contentType
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
  $response.OutputStream.Write($bytes, 0, $bytes.Length)
}

function Get-NextPostId($posts) {
  $max = 0
  foreach ($post in $posts) {
    if ($post.id -match "^\d+$") {
      $n = [int]$post.id
      if ($n -gt $max) { $max = $n }
    }
  }
  return ("{0:D3}" -f ($max + 1))
}

function Add-Post($payload) {
  if (-not (Test-Path $PostsFile -PathType Leaf)) {
    throw "posts.json not found"
  }

  $raw = [System.IO.File]::ReadAllText($PostsFile, [System.Text.Encoding]::UTF8)
  $data = $raw | ConvertFrom-Json

  if (-not $data.posts) {
    $data | Add-Member -NotePropertyName posts -NotePropertyValue @()
  }

  $origin = [string]$payload.origin
  $callsign = [string]$payload.callsign
  $lines = @($payload.lines)

  if ([string]::IsNullOrWhiteSpace($origin) -or [string]::IsNullOrWhiteSpace($callsign) -or $lines.Count -eq 0) {
    throw "origin, callsign and lines are required"
  }

  $sentAt = [string]$payload.sentAt
  if ([string]::IsNullOrWhiteSpace($sentAt)) {
    $sentAt = (Get-Date).ToString("o")
  }

  $newPost = [PSCustomObject]@{
    id       = Get-NextPostId @($data.posts)
    sentAt   = $sentAt
    origin   = $origin.Trim()
    callsign = $callsign.Trim()
    lines    = @($lines | ForEach-Object { [string]$_ })
    archived = $false
    lost     = $false
  }

  $imageBase64 = [string]$payload.imageBase64
  $imageName = [string]$payload.imageName
  if (-not [string]::IsNullOrWhiteSpace($imageBase64) -and -not [string]::IsNullOrWhiteSpace($imageName)) {
    $mediaDir = Join-Path $Root "media"
    if (-not (Test-Path $mediaDir -PathType Container)) {
      New-Item -ItemType Directory -Path $mediaDir | Out-Null
    }

    $ext = [System.IO.Path]::GetExtension($imageName).ToLowerInvariant()
    if ([string]::IsNullOrWhiteSpace($ext)) { $ext = ".jpg" }
    if ($ext -eq ".jpeg") { $ext = ".jpg" }
    $allowed = @(".jpg", ".png", ".webp", ".gif")
    if ($allowed -notcontains $ext) { $ext = ".jpg" }

    $fileName = "{0}-{1}{2}" -f $newPost.id, ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()), $ext
    $bytes = [Convert]::FromBase64String(($imageBase64 -replace "\s", ""))
    if ($bytes.Length -gt (8 * 1024 * 1024)) {
      throw "imagem acima de 8MB"
    }
    [System.IO.File]::WriteAllBytes((Join-Path $mediaDir $fileName), $bytes)

    $cleanName = ($imageName -replace '[^\w.\-()+ ]', '_')
    if ($cleanName.Length -gt 120) { $cleanName = $cleanName.Substring(0, 120) }
    if ([string]::IsNullOrWhiteSpace($cleanName)) { $cleanName = "attachment$ext" }

    $newPost | Add-Member -NotePropertyName image -NotePropertyValue ([PSCustomObject]@{
      src  = "media/$fileName"
      name = $cleanName
    }) -Force
  }

  $data.posts = @($data.posts) + @($newPost)

  $json = $data | ConvertTo-Json -Depth 10
  [System.IO.File]::WriteAllText($PostsFile, $json, [System.Text.Encoding]::UTF8)

  return $newPost
}

function Remove-Posts($ids) {
  if (-not (Test-Path $PostsFile -PathType Leaf)) {
    throw "posts.json not found"
  }

  $targetIds = @($ids | ForEach-Object { [string]$_ } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  if ($targetIds.Count -eq 0) {
    throw "ids are required"
  }

  $raw = [System.IO.File]::ReadAllText($PostsFile, [System.Text.Encoding]::UTF8)
  $data = $raw | ConvertFrom-Json

  if (-not $data.posts) {
    throw "no posts to remove"
  }

  $before = 0
  foreach ($post in @($data.posts)) {
    if ($targetIds -contains [string]$post.id) {
      if ($null -eq $post.lost -or -not [bool]$post.lost) {
        $post | Add-Member -NotePropertyName lost -NotePropertyValue $true -Force
        $post.lost = $true
        $before++
      }
    }
  }

  if ($before -eq 0) {
    throw "posts not found"
  }

  $json = $data | ConvertTo-Json -Depth 10
  [System.IO.File]::WriteAllText($PostsFile, $json, [System.Text.Encoding]::UTF8)

  return @{
    removed = $before
    ids     = $targetIds
  }
}

function Purge-Posts($ids) {
  if (-not (Test-Path $PostsFile -PathType Leaf)) {
    throw "posts.json not found"
  }

  $targetIds = @($ids | ForEach-Object { [string]$_ } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  if ($targetIds.Count -eq 0) {
    throw "ids are required"
  }

  $raw = [System.IO.File]::ReadAllText($PostsFile, [System.Text.Encoding]::UTF8)
  $data = $raw | ConvertFrom-Json

  if (-not $data.posts) {
    throw "no posts to purge"
  }

  $kept = @()
  $purged = 0
  foreach ($post in @($data.posts)) {
    if ($targetIds -contains [string]$post.id) {
      $purged++
    }
    else {
      $kept += $post
    }
  }

  if ($purged -eq 0) {
    throw "posts not found"
  }

  $data.posts = $kept
  $json = $data | ConvertTo-Json -Depth 10
  [System.IO.File]::WriteAllText($PostsFile, $json, [System.Text.Encoding]::UTF8)

  return @{
    purged = $purged
    ids    = $targetIds
  }
}

function Set-PostsArchived($ids, $archived) {
  if (-not (Test-Path $PostsFile -PathType Leaf)) {
    throw "posts.json not found"
  }

  $targetIds = @($ids | ForEach-Object { [string]$_ } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  if ($targetIds.Count -eq 0) {
    throw "ids are required"
  }

  $raw = [System.IO.File]::ReadAllText($PostsFile, [System.Text.Encoding]::UTF8)
  $data = $raw | ConvertFrom-Json

  if (-not $data.posts) {
    throw "no posts to update"
  }

  $updated = 0
  $nextPosts = @()

  foreach ($post in @($data.posts)) {
    if ($targetIds -contains [string]$post.id) {
      $post.archived = [bool]$archived
      $updated++
    }
    elseif ($null -eq $post.archived) {
      $post | Add-Member -NotePropertyName archived -NotePropertyValue $false -Force
    }
    $nextPosts += $post
  }

  if ($updated -eq 0) {
    throw "posts not found"
  }

  $data.posts = $nextPosts
  $json = $data | ConvertTo-Json -Depth 10
  [System.IO.File]::WriteAllText($PostsFile, $json, [System.Text.Encoding]::UTF8)

  return @{
    updated  = $updated
    ids      = $targetIds
    archived = [bool]$archived
  }
}

function Set-Config($payload) {
  if (-not (Test-Path $PostsFile -PathType Leaf)) {
    throw "posts.json not found"
  }

  $ver = [string]$payload.terminalVersion
  if ([string]::IsNullOrWhiteSpace($ver)) {
    throw "terminalVersion is required"
  }

  $raw = [System.IO.File]::ReadAllText($PostsFile, [System.Text.Encoding]::UTF8)
  $data = $raw | ConvertFrom-Json

  if ($null -eq $data.terminalVersion) {
    $data | Add-Member -NotePropertyName terminalVersion -NotePropertyValue $ver.Trim() -Force
  }
  else {
    $data.terminalVersion = $ver.Trim()
  }

  if (-not $data.posts) {
    $data | Add-Member -NotePropertyName posts -NotePropertyValue @() -Force
  }

  $json = $data | ConvertTo-Json -Depth 10
  [System.IO.File]::WriteAllText($PostsFile, $json, [System.Text.Encoding]::UTF8)

  return @{
    terminalVersion = [string]$data.terminalVersion
  }
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($Prefix)

try {
  $listener.Start()
}
catch {
  Write-Host "ERRO: nao foi possivel iniciar em $Prefix"
  Write-Host $_.Exception.Message
  exit 1
}

Write-Host "SPACE COMMS preview: $Prefix"
Write-Host "Admin: ${Prefix}admin.html"
Write-Host "Admin edit: ${Prefix}admin-edit.html"
Write-Host "Pasta: $Root"
Write-Host "Ctrl+C para encerrar."

while ($listener.IsListening) {
  $context = $listener.GetContext()
  $request = $context.Request
  $response = $context.Response

  try {
    $path = [Uri]::UnescapeDataString($request.Url.LocalPath).TrimStart("/")

    if ($request.HttpMethod -eq "POST" -and $path -eq "api/posts") {
      $reader = New-Object System.IO.StreamReader($request.InputStream, [System.Text.Encoding]::UTF8)
      $body = $reader.ReadToEnd()
      $reader.Close()

      if ([string]::IsNullOrWhiteSpace($body)) {
        Send-Response $response 400 '{"error":"empty body"}' "application/json; charset=utf-8"
      }
      else {
        $payload = $body | ConvertFrom-Json
        $created = Add-Post $payload
        $out = ($created | ConvertTo-Json -Depth 10 -Compress)
        Send-Response $response 201 $out "application/json; charset=utf-8"
      }
    }
    elseif ($request.HttpMethod -eq "DELETE" -and $path -eq "api/posts") {
      $reader = New-Object System.IO.StreamReader($request.InputStream, [System.Text.Encoding]::UTF8)
      $body = $reader.ReadToEnd()
      $reader.Close()

      if ([string]::IsNullOrWhiteSpace($body)) {
        Send-Response $response 400 '{"error":"empty body"}' "application/json; charset=utf-8"
      }
      else {
        $payload = $body | ConvertFrom-Json
        $result = Remove-Posts @($payload.ids)
        $out = ($result | ConvertTo-Json -Depth 10 -Compress)
        Send-Response $response 200 $out "application/json; charset=utf-8"
      }
    }
    elseif ($request.HttpMethod -eq "POST" -and $path -eq "api/posts/purge") {
      $reader = New-Object System.IO.StreamReader($request.InputStream, [System.Text.Encoding]::UTF8)
      $body = $reader.ReadToEnd()
      $reader.Close()

      if ([string]::IsNullOrWhiteSpace($body)) {
        Send-Response $response 400 '{"error":"empty body"}' "application/json; charset=utf-8"
      }
      else {
        $payload = $body | ConvertFrom-Json
        $result = Purge-Posts @($payload.ids)
        $out = ($result | ConvertTo-Json -Depth 10 -Compress)
        Send-Response $response 200 $out "application/json; charset=utf-8"
      }
    }
    elseif ($request.HttpMethod -eq "POST" -and $path -eq "api/config") {
      $reader = New-Object System.IO.StreamReader($request.InputStream, [System.Text.Encoding]::UTF8)
      $body = $reader.ReadToEnd()
      $reader.Close()

      if ([string]::IsNullOrWhiteSpace($body)) {
        Send-Response $response 400 '{"error":"empty body"}' "application/json; charset=utf-8"
      }
      else {
        $payload = $body | ConvertFrom-Json
        $result = Set-Config $payload
        $out = ($result | ConvertTo-Json -Depth 10 -Compress)
        Send-Response $response 200 $out "application/json; charset=utf-8"
      }
    }
    elseif ($request.HttpMethod -eq "POST" -and $path -eq "api/posts/archive") {
      $reader = New-Object System.IO.StreamReader($request.InputStream, [System.Text.Encoding]::UTF8)
      $body = $reader.ReadToEnd()
      $reader.Close()

      if ([string]::IsNullOrWhiteSpace($body)) {
        Send-Response $response 400 '{"error":"empty body"}' "application/json; charset=utf-8"
      }
      else {
        $payload = $body | ConvertFrom-Json
        $result = Set-PostsArchived @($payload.ids) $payload.archived
        $out = ($result | ConvertTo-Json -Depth 10 -Compress)
        Send-Response $response 200 $out "application/json; charset=utf-8"
      }
    }
    else {
      $relative = $path
      if ([string]::IsNullOrWhiteSpace($relative)) {
        $relative = "index.html"
      }

      $file = Join-Path $Root $relative

      if (Test-Path $file -PathType Leaf) {
        $bytes = [System.IO.File]::ReadAllBytes($file)
        $ext = [System.IO.Path]::GetExtension($file).ToLowerInvariant()
        $contentType = switch ($ext) {
          ".html"  { "text/html; charset=utf-8" }
          ".css"   { "text/css; charset=utf-8" }
          ".js"    { "application/javascript; charset=utf-8" }
          ".json"  { "application/json; charset=utf-8" }
          ".woff2" { "font/woff2" }
          ".png"   { "image/png" }
          ".jpg"   { "image/jpeg" }
          ".jpeg"  { "image/jpeg" }
          ".webp"  { "image/webp" }
          ".gif"   { "image/gif" }
          default  { "application/octet-stream" }
        }
        if ($ext -eq ".json") {
          $response.Headers.Add("Cache-Control", "no-store, no-cache, must-revalidate")
        }
        $response.ContentType = $contentType
        $response.StatusCode = 200
        $response.OutputStream.Write($bytes, 0, $bytes.Length)
      }
      else {
        Send-Response $response 404 "404 not found" "text/plain; charset=utf-8"
      }
    }
  }
  catch {
    $message = $_.Exception.Message.Replace('"', "'")
    Send-Response $response 500 "{ `"error`": `"$message`" }" "application/json; charset=utf-8"
  }

  $response.Close()
}
