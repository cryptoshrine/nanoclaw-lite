"""Main browser harness daemon — Unix socket JSON-RPC server + Chrome lifecycle."""

import asyncio
import json
import logging
import os
import signal
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

from .cdp import CDPError, CDPSession
from .config import CHROME_FLAGS, CHROME_PATH, SOCKET_PATH
from .skills import SkillStore

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


class BrowserHarness:
    """Persistent browser daemon with JSON-RPC interface over Unix socket."""

    def __init__(self):
        self.chrome_process: subprocess.Popen | None = None
        self.cdp: CDPSession | None = None
        self.skills = SkillStore()
        self._server: asyncio.Server | None = None
        self._ws_url: str | None = None

    async def start_chrome(self):
        """Launch Chrome/Chromium with remote debugging."""
        user_data_dir = tempfile.mkdtemp(prefix="browser-harness-")
        flags = CHROME_FLAGS + [f"--user-data-dir={user_data_dir}"]

        self.chrome_process = subprocess.Popen(
            [CHROME_PATH] + flags,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        logger.info("Chrome started (PID %d)", self.chrome_process.pid)

        # Wait for DevTools to be ready and discover the WS URL
        await asyncio.sleep(1)
        self._ws_url = await self._discover_ws_url()

        # Connect CDP
        self.cdp = CDPSession(self._ws_url)
        await self.cdp.connect()

    async def _discover_ws_url(self) -> str:
        """Discover Chrome DevTools WebSocket URL from the debug port."""
        # Read stderr for the DevTools listening message
        import aiohttp

        # Try common discovery endpoints
        for port in range(9222, 9232):
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.get(f"http://127.0.0.1:{port}/json/version", timeout=aiohttp.ClientTimeout(total=2)) as resp:
                        if resp.status == 200:
                            data = await resp.json()
                            ws_url = data.get("webSocketDebuggerUrl")
                            if ws_url:
                                logger.info("Found DevTools at port %d", port)
                                return ws_url
            except Exception:
                continue

        # Fallback: parse stderr
        stderr_output = self.chrome_process.stderr.read1(4096).decode() if self.chrome_process.stderr else ""
        for line in stderr_output.split("\n"):
            if "DevTools listening on" in line:
                return line.split("DevTools listening on ")[-1].strip()

        raise RuntimeError("Could not discover Chrome DevTools WebSocket URL")

    async def stop_chrome(self):
        """Terminate Chrome process."""
        if self.cdp:
            await self.cdp.disconnect()
        if self.chrome_process:
            self.chrome_process.terminate()
            try:
                self.chrome_process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.chrome_process.kill()
            logger.info("Chrome stopped")

    async def handle_rpc(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        """Handle a JSON-RPC 2.0 connection."""
        peer = writer.get_extra_info("peername") or "unix-client"
        logger.debug("Client connected: %s", peer)

        try:
            while True:
                data = await reader.readline()
                if not data:
                    break

                try:
                    request = json.loads(data.decode())
                except json.JSONDecodeError:
                    await self._send_error(writer, None, -32700, "Parse error")
                    continue

                req_id = request.get("id")
                method = request.get("method", "")
                params = request.get("params", {})

                try:
                    result = await self._dispatch(method, params)
                    response = {"jsonrpc": "2.0", "id": req_id, "result": result}
                except CDPError as e:
                    response = {"jsonrpc": "2.0", "id": req_id, "error": {"code": -32000, "message": str(e)}}
                except Exception as e:
                    logger.exception("RPC error in %s", method)
                    response = {"jsonrpc": "2.0", "id": req_id, "error": {"code": -32603, "message": str(e)}}

                writer.write(json.dumps(response).encode() + b"\n")
                await writer.drain()
        except asyncio.CancelledError:
            pass
        finally:
            writer.close()
            await writer.wait_closed()

    async def _dispatch(self, method: str, params: dict) -> Any:
        """Route RPC method to handler."""
        handlers = {
            "navigate": self._handle_navigate,
            "evaluate": self._handle_evaluate,
            "click": self._handle_click,
            "fill": self._handle_fill,
            "screenshot": self._handle_screenshot,
            "wait_for": self._handle_wait_for,
            "get_html": self._handle_get_html,
            "get_text": self._handle_get_text,
            "get_url": self._handle_get_url,
            "get_title": self._handle_get_title,
            "skill_record": self._handle_skill_record,
            "skill_find": self._handle_skill_find,
            "skill_execute": self._handle_skill_execute,
            "skill_stats": self._handle_skill_stats,
            "skill_prune": self._handle_skill_prune,
            "health": self._handle_health,
        }

        handler = handlers.get(method)
        if not handler:
            raise ValueError(f"Unknown method: {method}")
        return await handler(params)

    # --- CDP handlers ---

    async def _handle_navigate(self, params: dict) -> dict:
        return await self.cdp.navigate(params["url"])

    async def _handle_evaluate(self, params: dict) -> Any:
        return await self.cdp.evaluate(params["expression"])

    async def _handle_click(self, params: dict) -> dict:
        return await self.cdp.click(params["selector"])

    async def _handle_fill(self, params: dict) -> dict:
        return await self.cdp.fill(params["selector"], params["value"])

    async def _handle_screenshot(self, params: dict) -> dict:
        data = await self.cdp.screenshot(full_page=params.get("full_page", False))
        return {"base64": data, "format": "png"}

    async def _handle_wait_for(self, params: dict) -> dict:
        return await self.cdp.wait_for(params["selector"], timeout=params.get("timeout"))

    async def _handle_get_html(self, params: dict) -> str:
        return await self.cdp.get_html(params.get("selector", "body"))

    async def _handle_get_text(self, params: dict) -> str:
        return await self.cdp.get_text(params.get("selector", "body"))

    async def _handle_get_url(self, params: dict) -> str:
        return await self.cdp.get_url()

    async def _handle_get_title(self, params: dict) -> str:
        return await self.cdp.get_title()

    # --- Skill handlers ---

    async def _handle_skill_record(self, params: dict) -> dict:
        return self.skills.record(
            domain=params["domain"],
            name=params["name"],
            action=params["action"],
            selector=params.get("selector"),
            params=params.get("params"),
            success=params.get("success", True),
        )

    async def _handle_skill_find(self, params: dict) -> list:
        return self.skills.find(params["domain"], params.get("name"))

    async def _handle_skill_execute(self, params: dict) -> dict | None:
        return self.skills.execute(params["domain"], params["name"])

    async def _handle_skill_stats(self, params: dict) -> dict:
        return self.skills.stats()

    async def _handle_skill_prune(self, params: dict) -> dict:
        pruned = self.skills.prune()
        return {"pruned": pruned}

    async def _handle_health(self, params: dict) -> dict:
        return {
            "status": "ok",
            "chrome_pid": self.chrome_process.pid if self.chrome_process else None,
            "ws_url": self._ws_url,
            "skills": self.skills.stats(),
        }

    async def _send_error(self, writer, req_id, code: int, message: str):
        response = {"jsonrpc": "2.0", "id": req_id, "error": {"code": code, "message": message}}
        writer.write(json.dumps(response).encode() + b"\n")
        await writer.drain()

    async def run(self):
        """Start the daemon: launch Chrome, open Unix socket server."""
        # Ensure socket directory exists
        socket_path = Path(SOCKET_PATH)
        socket_path.parent.mkdir(parents=True, exist_ok=True)

        # Remove stale socket
        if socket_path.exists():
            socket_path.unlink()

        # Start Chrome
        await self.start_chrome()

        # Start Unix socket server
        self._server = await asyncio.start_unix_server(
            self.handle_rpc, path=str(socket_path)
        )
        os.chmod(str(socket_path), 0o660)
        logger.info("Daemon listening on %s", SOCKET_PATH)

        # Handle shutdown signals
        loop = asyncio.get_event_loop()
        for sig in (signal.SIGTERM, signal.SIGINT):
            loop.add_signal_handler(sig, lambda: asyncio.create_task(self.shutdown()))

        async with self._server:
            await self._server.serve_forever()

    async def shutdown(self):
        """Graceful shutdown."""
        logger.info("Shutting down...")
        if self._server:
            self._server.close()
        await self.stop_chrome()
        self.skills.close()

        # Remove socket file
        socket_path = Path(SOCKET_PATH)
        if socket_path.exists():
            socket_path.unlink()


def main():
    """Entry point for the daemon."""
    daemon = BrowserHarness()
    try:
        asyncio.run(daemon.run())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
