# SPDX-License-Identifier: MIT
# Creates envs/ai-cuda | envs/ai-rocm | envs/ai and installs matching PyTorch.
param(
    [ValidateSet("auto", "cuda", "rocm", "cpu")]
    [string]$Backend = $(if ($env:NUWA_GPU_BACKEND) { $env:NUWA_GPU_BACKEND } else { "auto" })
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

function Test-Smi([string]$Name) {
    try {
        & $Name -L *> $null
        if ($LASTEXITCODE -eq 0) { return $true }
    } catch {}
    try {
        & $Name --help *> $null
        if ($LASTEXITCODE -eq 0) { return $true }
    } catch {}
    $found = Get-Command $Name -ErrorAction SilentlyContinue
    return $null -ne $found
}

function Resolve-Backend([string]$B) {
    $B = $B.Trim().ToLowerInvariant()
    if ($B -eq "auto" -or $B -eq "") {
        if (Test-Smi "nvidia-smi") { return "cuda" }
        if (Test-Smi "rocm-smi") { return "rocm" }
        return "cpu"
    }
    return $B
}

$Resolved = Resolve-Backend $Backend
Write-Host "Resolved GPU backend: $Resolved"

$VenvRel = switch ($Resolved) {
    "cuda" { "envs\ai-cuda" }
    "rocm" { "envs\ai-rocm" }
    default { "envs\ai" }
}
$Venv = Join-Path $Root $VenvRel
$Py = Join-Path $Venv "Scripts\python.exe"

if (-not (Test-Path $Py)) {
    Write-Host "Creating venv at $VenvRel ..."
    New-Item -ItemType Directory -Force -Path (Split-Path $Venv) | Out-Null
    python -m venv $Venv
}

& $Py -m pip install --upgrade pip
switch ($Resolved) {
    "cuda" {
        # Blackwell / RTX 5070: CUDA 12.8 wheels
        & $Py -m pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128
    }
    "rocm" {
        & $Py -m pip install --index-url https://rocm.nightlies.amd.com/v2-staging/gfx120X-all/ torch torchvision torchaudio
    }
    default {
        & $Py -m pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu
    }
}

Write-Host "Verifying torch..."
& $Py -c "import torch; print(torch.__version__); print(torch.cuda.is_available()); print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'NO_GPU')"

Write-Host ""
Write-Host "Next:"
Write-Host "  `$env:NUWA_GPU_BACKEND = '$Resolved'   # optional override"
if ($Resolved -eq "cuda") {
    Write-Host "  Install CUDA-enabled Ollama; see docs/nvidia_cuda_setup.md"
} elseif ($Resolved -eq "rocm") {
    Write-Host "  Configure ROCBLAS_TENSILE_LIBPATH; see docs/rx9070xt_ai_setup.md"
}
Write-Host "Done. Venv: $VenvRel"
