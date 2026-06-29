# 将 AI 模型缓存迁移到 E 盘
# 以管理员权限运行 PowerShell 后执行此脚本

$cacheRoot = "E:\cache"

# 1. HuggingFace 缓存
[Environment]::SetEnvironmentVariable("HF_HOME", "$cacheRoot\huggingface", "User")
[Environment]::SetEnvironmentVariable("HF_HUB_CACHE", "$cacheRoot\huggingface\hub", "User")
Write-Host "[OK] HF_HOME -> $cacheRoot\huggingface" -ForegroundColor Green

# 2. ModelScope 缓存
[Environment]::SetEnvironmentVariable("MODELSCOPE_CACHE", "$cacheRoot\modelscope", "User")
Write-Host "[OK] MODELSCOPE_CACHE -> $cacheRoot\modelscope" -ForegroundColor Green

# 3. pip 缓存
[Environment]::SetEnvironmentVariable("PIP_CACHE_DIR", "$cacheRoot\pip", "User")
Write-Host "[OK] PIP_CACHE_DIR -> $cacheRoot\pip" -ForegroundColor Green

# 4. 创建目录（如果不存在）
@("$cacheRoot\huggingface", "$cacheRoot\modelscope", "$cacheRoot\pip") | ForEach-Object {
    New-Item -Path $_ -ItemType Directory -Force | Out-Null
}

Write-Host "`n所有缓存路径已设置为 E 盘。`n请重启终端或 IDE 使环境变量生效。" -ForegroundColor Cyan
Write-Host "`n当前会话临时生效（测试用）：" -ForegroundColor Yellow
Write-Host "  $env:HF_HOME = '$cacheRoot\huggingface'"
Write-Host "  $env:MODELSCOPE_CACHE = '$cacheRoot\modelscope'"
