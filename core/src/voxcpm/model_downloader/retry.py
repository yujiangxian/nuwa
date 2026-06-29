"""重试策略：指数退避、连接轮换。"""

from __future__ import annotations

import random
import time
from typing import Callable, TypeVar

T = TypeVar("T")


def exponential_backoff(
    attempt: int,
    base_delay: float = 1.0,
    max_delay: float = 60.0,
    jitter: bool = True,
) -> float:
    """计算指数退避延迟。"""
    delay = min(base_delay * (2 ** attempt), max_delay)
    if jitter:
        delay *= random.uniform(0.8, 1.2)
    return delay


def retry_with_backoff(
    fn: Callable[[], T],
    max_attempts: int = 5,
    exceptions: tuple[type[Exception], ...] = (Exception,),
    on_retry: Callable[[int, Exception, float], None] | None = None,
) -> T:
    """带指数退避的重试装饰器。"""
    last_err = None
    for attempt in range(max_attempts):
        try:
            return fn()
        except exceptions as e:
            last_err = e
            if attempt < max_attempts - 1:
                delay = exponential_backoff(attempt)
                if on_retry:
                    on_retry(attempt, e, delay)
                time.sleep(delay)
    raise last_err  # type: ignore[misc]
