import asyncio
from pathlib import Path


class LocalFilesystemStorageAdapter:
    """Dev-only storage adapter -- unencrypted, local disk.

    The real "encrypted object-storage adapter" docs/security-model.md asks
    for depends on a cloud provider choice that hasn't been made yet
    (docs/product-requirements.md). This exists so endpoint code never has
    to change when that adapter is added -- only get_storage_adapter() does.
    """

    def __init__(self, base_dir: str) -> None:
        self._base_dir = Path(base_dir)

    def _path_for(self, key: str) -> Path:
        path = (self._base_dir / key).resolve()
        if self._base_dir.resolve() not in path.parents and path != self._base_dir.resolve():
            raise ValueError(f"Storage key escapes base directory: {key}")
        return path

    async def save(self, key: str, content: bytes) -> None:
        path = self._path_for(key)

        def _write() -> None:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)

        await asyncio.to_thread(_write)

    async def read(self, key: str) -> bytes:
        path = self._path_for(key)
        return await asyncio.to_thread(path.read_bytes)

    async def delete(self, key: str) -> None:
        path = self._path_for(key)

        def _delete() -> None:
            path.unlink(missing_ok=True)

        await asyncio.to_thread(_delete)
