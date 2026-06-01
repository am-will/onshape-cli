"""Credential resolution and storage for the Onshape CLI."""

from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Mapping, Optional
from urllib.parse import urlparse

DEFAULT_BASE_URL = "https://cad.onshape.com"
KEYCHAIN_SERVICE = "onshape-cli"


class CredentialError(RuntimeError):
    """Base class for credential store failures."""


class KeychainUnavailable(CredentialError):
    """Raised when the optional keychain backend is unavailable."""


@dataclass(frozen=True)
class CredentialRecord:
    access_key: str
    secret_key: str
    base_url: str = DEFAULT_BASE_URL


@dataclass(frozen=True)
class CredentialDescription:
    configured: bool
    path: str
    backend: Optional[str] = None
    source: Optional[str] = None
    access_key: Optional[str] = None
    secret_key: Optional[str] = None
    base_url: str = DEFAULT_BASE_URL
    account: Optional[str] = None
    keychain_available: Optional[bool] = None

    def to_dict(self) -> Dict[str, Any]:
        data: Dict[str, Any] = {
            "configured": self.configured,
            "path": self.path,
            "base_url": self.base_url,
        }
        for key in ("backend", "source", "access_key", "secret_key", "account"):
            value = getattr(self, key)
            if value is not None:
                data[key] = value
        if self.keychain_available is not None:
            data["keychain_available"] = self.keychain_available
        return data


def redact_secret(secret: str) -> str:
    """Return a display-safe secret-key preview."""
    return f"{secret[:3]}...{secret[-3:]}" if len(secret) > 8 else "***"


def account_for_base_url(base_url: str) -> str:
    """Derive the shared keychain account from an Onshape base URL."""
    parsed = urlparse(base_url)
    if not parsed.hostname:
        parsed = urlparse(f"//{base_url}")
    return parsed.hostname or base_url


class CredentialStore:
    """Resolve, save, clear, and describe Onshape credentials."""

    def __init__(
        self,
        *,
        env: Optional[Mapping[str, str]] = None,
        home: Optional[Path] = None,
    ) -> None:
        self.env = env if env is not None else os.environ
        self.home = home or Path.home()

    def config_path(self) -> Path:
        override = self.env.get("ONSHAPE_CONFIG")
        if override:
            return Path(override).expanduser()
        return self.home / ".onshape" / "credentials.json"

    def xdg_config_path(self) -> Optional[Path]:
        if not sys.platform.startswith("linux"):
            return None
        xdg_home = self.env.get("XDG_CONFIG_HOME")
        if not xdg_home:
            return None
        return Path(xdg_home).expanduser() / "onshape" / "credentials.json"

    def resolve(
        self,
        *,
        access_key: Optional[str] = None,
        secret_key: Optional[str] = None,
        base_url: Optional[str] = None,
    ) -> CredentialRecord:
        """Resolve credentials using the shared precedence contract."""
        env_access = self.env.get("ONSHAPE_ACCESS_KEY")
        env_secret = self.env.get("ONSHAPE_SECRET_KEY")
        env_base = self.env.get("ONSHAPE_BASE_URL")

        file_creds = self._first_file_credentials()
        mcp_creds = self._mcp_credentials()

        source_base = (
            (file_creds or {}).get("base_url")
            or (mcp_creds or {}).get("base_url")
            or DEFAULT_BASE_URL
        )
        resolved_access = (
            access_key
            or env_access
            or (file_creds or {}).get("access_key")
            or (mcp_creds or {}).get("access_key")
        )
        resolved_secret = (
            secret_key
            or env_secret
            or (file_creds or {}).get("secret_key")
            or (mcp_creds or {}).get("secret_key")
        )
        resolved_base = base_url or env_base or source_base or DEFAULT_BASE_URL

        if not (resolved_access and resolved_secret):
            raise CredentialError(
                "No credentials. Run 'onshape-cli login', set "
                "ONSHAPE_ACCESS_KEY / ONSHAPE_SECRET_KEY, or pass "
                "--access-key/--secret-key."
            )
        return CredentialRecord(
            access_key=resolved_access,
            secret_key=resolved_secret,
            base_url=resolved_base,
        )

    def save(
        self,
        creds: CredentialRecord,
        *,
        store: str = "auto",
    ) -> Dict[str, Any]:
        """Persist credentials using file, keychain, or auto mode."""
        if store not in {"auto", "file", "keychain"}:
            raise CredentialError("store must be one of: auto, file, keychain")

        if store in {"auto", "keychain"}:
            try:
                self._save_keychain(creds)
                return {
                    "saved": True,
                    "backend": "keychain",
                    "path": str(self.config_path()),
                    "account": account_for_base_url(creds.base_url),
                }
            except KeychainUnavailable:
                if store == "keychain":
                    raise

        self._write_credentials_file(
            {
                "backend": "file",
                "access_key": creds.access_key,
                "secret_key": creds.secret_key,
                "base_url": creds.base_url,
            }
        )
        return {"saved": True, "backend": "file", "path": str(self.config_path())}

    def clear(self) -> Dict[str, Any]:
        """Delete the pointer/fallback file and best-effort keychain item."""
        path = self.config_path()
        data = self._read_json(path)
        base_url = data.get("base_url", DEFAULT_BASE_URL) if isinstance(data, dict) else DEFAULT_BASE_URL
        account = (
            data.get("account")
            if isinstance(data, dict)
            else None
        ) or account_for_base_url(base_url)
        file_existed = path.exists()
        if file_existed:
            path.unlink()

        keychain_deleted = False
        if isinstance(data, dict) and data.get("backend") == "keychain":
            try:
                self._delete_keychain(account)
                keychain_deleted = True
            except KeychainUnavailable:
                keychain_deleted = False
        return {
            "cleared": file_existed or keychain_deleted,
            "path": str(path),
            "keychain_deleted": keychain_deleted,
        }

    def describe(self) -> CredentialDescription:
        """Describe saved credentials without revealing the secret."""
        path = self.config_path()
        data = self._read_json(path)
        if not isinstance(data, dict) or not data:
            return CredentialDescription(configured=False, path=str(path))

        backend = data.get("backend", "file" if data.get("secret_key") else None)
        base_url = data.get("base_url", DEFAULT_BASE_URL)
        secret = data.get("secret_key")
        account = data.get("account") or account_for_base_url(base_url)
        keychain_available = None

        if backend == "keychain":
            try:
                secret = self._load_keychain(account).get("secret_key")
                keychain_available = True
            except KeychainUnavailable:
                keychain_available = False

        return CredentialDescription(
            configured=bool(data.get("access_key")),
            path=str(path),
            backend=backend,
            source="file",
            access_key=data.get("access_key"),
            secret_key=redact_secret(secret) if secret else None,
            base_url=base_url,
            account=account if backend == "keychain" else None,
            keychain_available=keychain_available,
        )

    def _first_file_credentials(self) -> Optional[Dict[str, str]]:
        for path in [self.config_path(), self.xdg_config_path()]:
            if not path:
                continue
            creds = self._credentials_from_file(path)
            if creds:
                return creds
        return None

    def _credentials_from_file(self, path: Path) -> Optional[Dict[str, str]]:
        data = self._read_json(path)
        if not isinstance(data, dict):
            return None

        backend = data.get("backend")
        base_url = data.get("base_url", DEFAULT_BASE_URL)
        if backend == "keychain":
            account = data.get("account") or account_for_base_url(base_url)
            try:
                stored = self._load_keychain(account)
            except KeychainUnavailable:
                return None
            return {
                "access_key": stored.get("access_key") or data.get("access_key"),
                "secret_key": stored.get("secret_key"),
                "base_url": stored.get("base_url") or base_url,
            }

        access = data.get("access_key")
        secret = data.get("secret_key")
        if access and secret:
            return {
                "access_key": access,
                "secret_key": secret,
                "base_url": base_url,
            }
        return None

    def _mcp_credentials(self) -> Optional[Dict[str, str]]:
        path = self.home / ".claude" / "mcp.json"
        data = self._read_json(path)
        try:
            env = data["mcpServers"]["onshape"]["env"]
        except Exception:
            return None
        access = env.get("ONSHAPE_ACCESS_KEY")
        secret = env.get("ONSHAPE_SECRET_KEY")
        base_url = env.get("ONSHAPE_BASE_URL", DEFAULT_BASE_URL)
        if access and secret:
            return {
                "access_key": access,
                "secret_key": secret,
                "base_url": base_url,
            }
        return None

    def _save_keychain(self, creds: OnshapeCredentials) -> None:
        account = account_for_base_url(creds.base_url)
        keyring = self._keyring()
        value = json.dumps(
            {
                "access_key": creds.access_key,
                "secret_key": creds.secret_key,
                "base_url": creds.base_url,
            },
            separators=(",", ":"),
        )
        try:
            keyring.set_password(KEYCHAIN_SERVICE, account, value)
        except Exception as exc:  # noqa: BLE001
            raise KeychainUnavailable(str(exc)) from exc
        self._write_credentials_file(
            {
                "backend": "keychain",
                "access_key": creds.access_key,
                "base_url": creds.base_url,
                "account": account,
            }
        )

    def _load_keychain(self, account: str) -> Dict[str, str]:
        keyring = self._keyring()
        try:
            raw = keyring.get_password(KEYCHAIN_SERVICE, account)
        except Exception as exc:  # noqa: BLE001
            raise KeychainUnavailable(str(exc)) from exc
        if not raw:
            raise KeychainUnavailable("No keychain item found.")
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise KeychainUnavailable("Keychain item is not valid JSON.") from exc
        if not isinstance(data, dict):
            raise KeychainUnavailable("Keychain item has the wrong shape.")
        return data

    def _delete_keychain(self, account: str) -> None:
        keyring = self._keyring()
        try:
            keyring.delete_password(KEYCHAIN_SERVICE, account)
        except Exception as exc:  # noqa: BLE001
            raise KeychainUnavailable(str(exc)) from exc

    def _keyring(self):
        try:
            import keyring  # type: ignore
        except Exception as exc:  # noqa: BLE001
            raise KeychainUnavailable(str(exc)) from exc
        return keyring

    def _read_json(self, path: Path) -> Dict[str, Any]:
        if not path.exists():
            return {}
        try:
            data = json.loads(path.read_text())
        except Exception:
            return {}
        return data if isinstance(data, dict) else {}

    def _write_credentials_file(self, data: Dict[str, Any]) -> Path:
        path = self.config_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            os.chmod(path.parent, 0o700)
        except OSError:
            pass
        path.write_text(json.dumps(data, indent=2) + "\n")
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass
        return path
