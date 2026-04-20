"""CDP WebSocket manager — low-level Chrome DevTools Protocol operations."""

import asyncio
import base64
import json
import logging
from typing import Any

import websockets

from .config import ACTION_TIMEOUT, NAVIGATION_TIMEOUT, SCREENSHOT_TIMEOUT

logger = logging.getLogger(__name__)


class CDPSession:
    """Manages a WebSocket connection to Chrome DevTools Protocol."""

    def __init__(self, ws_url: str):
        self.ws_url = ws_url
        self._ws = None
        self._msg_id = 0
        self._pending: dict[int, asyncio.Future] = {}
        self._events: asyncio.Queue = asyncio.Queue()
        self._reader_task = None

    async def connect(self):
        """Establish WebSocket connection to Chrome."""
        self._ws = await websockets.connect(self.ws_url, max_size=50 * 1024 * 1024)
        self._reader_task = asyncio.create_task(self._reader_loop())
        # Enable required domains
        await self._send("Page.enable")
        await self._send("Runtime.enable")
        await self._send("DOM.enable")
        logger.info("CDP session connected: %s", self.ws_url)

    async def disconnect(self):
        """Close the WebSocket connection."""
        if self._reader_task:
            self._reader_task.cancel()
        if self._ws:
            await self._ws.close()
        logger.info("CDP session disconnected")

    async def _reader_loop(self):
        """Read messages from WebSocket and dispatch to pending futures or event queue."""
        try:
            async for raw in self._ws:
                msg = json.loads(raw)
                msg_id = msg.get("id")
                if msg_id is not None and msg_id in self._pending:
                    self._pending[msg_id].set_result(msg)
                elif "method" in msg:
                    await self._events.put(msg)
        except websockets.ConnectionClosed:
            logger.warning("CDP WebSocket closed")
        except asyncio.CancelledError:
            pass

    async def _send(self, method: str, params: dict | None = None, timeout: float = ACTION_TIMEOUT) -> dict:
        """Send a CDP command and wait for response."""
        self._msg_id += 1
        msg_id = self._msg_id
        payload = {"id": msg_id, "method": method}
        if params:
            payload["params"] = params

        future = asyncio.get_event_loop().create_future()
        self._pending[msg_id] = future

        await self._ws.send(json.dumps(payload))
        try:
            result = await asyncio.wait_for(future, timeout=timeout)
        finally:
            self._pending.pop(msg_id, None)

        if "error" in result:
            raise CDPError(result["error"].get("message", "Unknown CDP error"))
        return result.get("result", {})

    # --- High-level operations ---

    async def navigate(self, url: str) -> dict:
        """Navigate to a URL and wait for load."""
        result = await self._send("Page.navigate", {"url": url}, timeout=NAVIGATION_TIMEOUT)
        # Wait for load event
        await self._send("Page.lifecycleEvent", timeout=NAVIGATION_TIMEOUT)
        return {"url": url, "frameId": result.get("frameId")}

    async def evaluate(self, expression: str) -> Any:
        """Evaluate JavaScript in the page context."""
        result = await self._send("Runtime.evaluate", {
            "expression": expression,
            "returnByValue": True,
            "awaitPromise": True,
        })
        remote_obj = result.get("result", {})
        if remote_obj.get("type") == "undefined":
            return None
        return remote_obj.get("value")

    async def click(self, selector: str) -> dict:
        """Click an element by CSS selector."""
        # Find the element
        doc = await self._send("DOM.getDocument")
        node = await self._send("DOM.querySelector", {
            "nodeId": doc["root"]["nodeId"],
            "selector": selector,
        })
        if not node.get("nodeId"):
            raise CDPError(f"Element not found: {selector}")

        # Get box model for click coordinates
        box = await self._send("DOM.getBoxModel", {"nodeId": node["nodeId"]})
        quad = box["model"]["content"]
        x = (quad[0] + quad[2] + quad[4] + quad[6]) / 4
        y = (quad[1] + quad[3] + quad[5] + quad[7]) / 4

        # Dispatch click events
        for event_type in ["mousePressed", "mouseReleased"]:
            await self._send("Input.dispatchMouseEvent", {
                "type": event_type,
                "x": x,
                "y": y,
                "button": "left",
                "clickCount": 1,
            })
        return {"selector": selector, "x": x, "y": y}

    async def fill(self, selector: str, value: str) -> dict:
        """Fill an input field with text."""
        # Focus the element
        doc = await self._send("DOM.getDocument")
        node = await self._send("DOM.querySelector", {
            "nodeId": doc["root"]["nodeId"],
            "selector": selector,
        })
        if not node.get("nodeId"):
            raise CDPError(f"Element not found: {selector}")

        await self._send("DOM.focus", {"nodeId": node["nodeId"]})

        # Clear existing value and type new one
        await self.evaluate(f'document.querySelector("{selector}").value = ""')
        for char in value:
            await self._send("Input.dispatchKeyEvent", {
                "type": "keyDown",
                "text": char,
            })
            await self._send("Input.dispatchKeyEvent", {
                "type": "keyUp",
                "text": char,
            })
        return {"selector": selector, "filled": len(value)}

    async def screenshot(self, full_page: bool = False) -> str:
        """Take a screenshot, returns base64 PNG."""
        params = {"format": "png"}
        if full_page:
            # Get full page dimensions
            metrics = await self._send("Page.getLayoutMetrics")
            content_size = metrics.get("contentSize", {})
            params["clip"] = {
                "x": 0, "y": 0,
                "width": content_size.get("width", 1280),
                "height": content_size.get("height", 720),
                "scale": 1,
            }
        result = await self._send("Page.captureScreenshot", params, timeout=SCREENSHOT_TIMEOUT)
        return result["data"]

    async def wait_for(self, selector: str, timeout: float = None) -> dict:
        """Wait for an element to appear in the DOM."""
        timeout = timeout or ACTION_TIMEOUT
        deadline = asyncio.get_event_loop().time() + timeout
        while asyncio.get_event_loop().time() < deadline:
            result = await self.evaluate(
                f'document.querySelector("{selector}") !== null'
            )
            if result:
                return {"selector": selector, "found": True}
            await asyncio.sleep(0.25)
        raise CDPError(f"Timeout waiting for: {selector}")

    async def get_html(self, selector: str = "body") -> str:
        """Get outerHTML of an element."""
        html = await self.evaluate(
            f'document.querySelector("{selector}")?.outerHTML || ""'
        )
        return html

    async def get_text(self, selector: str = "body") -> str:
        """Get textContent of an element."""
        text = await self.evaluate(
            f'document.querySelector("{selector}")?.textContent || ""'
        )
        return text

    async def get_url(self) -> str:
        """Get current page URL."""
        return await self.evaluate("window.location.href")

    async def get_title(self) -> str:
        """Get current page title."""
        return await self.evaluate("document.title")


class CDPError(Exception):
    """Error from Chrome DevTools Protocol."""
    pass
