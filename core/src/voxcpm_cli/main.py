"""VoxCPM CLI 入口。"""

from __future__ import annotations

from pathlib import Path

import typer

from voxcpm.model_downloader import download

app = typer.Typer(help="VoxCPM 命令行工具")


@app.command()
def dl(
    url: str = typer.Argument(..., help="下载地址或 repo_id"),
    dest: Path = typer.Option(Path("."), "--dest", "-d", help="保存目录"),
    threads: int = typer.Option(16, "--threads", "-t", help="并发线程数"),
    chunk_size: str = typer.Option("8MB", "--chunk-size", "-c", help="分片大小"),
    mirror: list[str] = typer.Option([], "--mirror", "-m", help="备用镜像地址（可多次指定）"),
    checksum: str | None = typer.Option(None, "--checksum", help="校验和，格式：sha256:abc123"),
) -> None:
    """多线程下载模型文件。"""
    # 解析 chunk_size
    size_map = {"KB": 1024, "MB": 1024 ** 2, "GB": 1024 ** 3}
    chunk_bytes = 8 * 1024 * 1024
    for unit, mult in size_map.items():
        if chunk_size.upper().endswith(unit):
            chunk_bytes = int(chunk_size[:-2]) * mult
            break

    dest_path = dest / Path(url).name
    typer.echo(f"开始下载: {url}")
    typer.echo(f"目标: {dest_path}")
    typer.echo(f"线程: {threads}, 分片: {chunk_size}")

    def on_progress(info):
        typer.echo(
            f"\r{info.percent:.1f}% | "
            f"{info.speed / 1024 / 1024:.1f} MB/s | "
            f"ETA {info.eta:.0f}s | "
            f"活跃线程 {info.threads_active}",
            nl=False,
        )

    try:
        download(
            url=url,
            dest=dest_path,
            threads=threads,
            chunk_size=chunk_bytes,
            mirrors=mirror or None,
            checksum=checksum,
            on_progress=on_progress,
        )
        typer.echo("\n✅ 下载完成")
    except Exception as e:
        typer.echo(f"\n❌ 下载失败: {e}")
        raise typer.Exit(1)


if __name__ == "__main__":
    app()
