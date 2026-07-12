# -*- coding: utf-8 -*-
"""
Sentinel Security Intelligence Platform - Official Python SDK
Version: 1.0.0

Zero-dependency Python client for querying Sentinel intelligence feeds,
initiating synchronous/asynchronous asset scans, and polling completed reports.
"""

import json
import time
import urllib.request
import urllib.error
from typing import Any, Dict, Optional, Union


class SentinelError(Exception):
    """Base exception for all Sentinel API and SDK errors."""
    pass


class Sentinel:
    def __init__(self, api_key: str, base_url: str = "http://localhost:3000"):
        """
        Initializes the Sentinel client.

        Args:
            api_key (str): Developer API key issued via the Sentinel platform.
            base_url (str): Remote endpoint of the Sentinel gateway router.
        """
        if not api_key:
            raise ValueError("Sentinel SDK: A valid api_key is required.")
        
        self.api_key = str(api_key).strip()
        self.base_url = str(base_url).rstrip("/")

    def _request(self, path: str, method: str = "GET", data: Optional[Dict[str, Any]] = None) -> Any:
        """
        Executes an authenticated HTTP request to the Sentinel API Gateway.
        """
        url = f"{self.base_url}{path}"
        headers = {
            "Content-Type": "application/json",
            "X-API-Key": self.api_key,
            "Authorization": f"Bearer {self.api_key}"
        }

        req_data = None
        if data is not None:
            req_data = json.dumps(data).encode("utf-8")

        req = urllib.request.Request(url, data=req_data, headers=headers, method=method)

        try:
            with urllib.request.urlopen(req) as response:
                res_body = response.read().decode("utf-8")
                return json.loads(res_body) if res_body else {}
        except urllib.error.HTTPError as err:
            err_msg = err.reason
            try:
                err_body = json.loads(err.read().decode("utf-8"))
                err_msg = err_body.get("error", err_msg)
            except Exception:
                pass
            raise SentinelError(f"Sentinel API Server Error [HTTP {err.code}]: {err_msg}")
        except Exception as ex:
            raise SentinelError(f"Sentinel Connection Error: {str(ex)}")

    def investigate(self, type: str, value: str) -> Dict[str, Any]:
        """
        Runs a synchronous perimeter asset lookup and synthesizes threat reports.
        Leverages parallel scanning connectors and Gemini meta-analysis.

        Args:
            type (str): Target entity category (e.g. 'domain', 'email', 'company').
            value (str): Specific value to investigate (e.g. 'openai.com').
        """
        if not type or not value:
            raise ValueError("Sentinel SDK: Both 'type' and 'value' parameters are required.")
        
        payload = {
            "type": str(type),
            "value": str(value)
        }
        return self._request("/api/v1/investigate", method="POST", data=payload)

    def create_investigation_job(self, type: str, value: str) -> Dict[str, Any]:
        """
        Spawns an asynchronous background scanning job.
        Returns immediately with a jobId to track incremental execution progress.
        """
        if not type or not value:
            raise ValueError("Sentinel SDK: Both 'type' and 'value' parameters are required.")
        
        payload = {
            "type": str(type),
            "value": str(value)
        }
        return self._request("/api/v1/investigations", method="POST", data=payload)

    def get_investigation_job(self, job_id: str) -> Dict[str, Any]:
        """
        Queries live status and completed report metadata of an active async job.
        """
        if not job_id:
            raise ValueError("Sentinel SDK: A valid job_id is required.")
        
        return self._request(f"/api/v1/investigations/{job_id}", method="GET")

    def poll_investigation_job(self, job_id: str, interval_sec: int = 1, timeout_sec: int = 120) -> Dict[str, Any]:
        """
        Helper method to block and poll job progress until completion.
        Returns the final synthesized report payload once the job has completed.
        """
        start_time = time.time()
        while True:
            if time.time() - start_time > timeout_sec:
                raise SentinelError(f"Sentinel SDK: Polling timeout reached for job '{job_id}'.")

            job = self.get_investigation_job(job_id)
            status = job.get("status")

            if status == "completed":
                report = job.get("report")
                if report:
                    return report
                result_id = job.get("resultId")
                if result_id:
                    return self.get_report(result_id)
                raise SentinelError(f"Sentinel SDK: Job '{job_id}' marked completed but returned no report content.")

            elif status == "failed":
                raise SentinelError(f"Sentinel SDK: Job '{job_id}' failed: {job.get('error', 'Unknown error')}")

            elif status == "cancelled":
                raise SentinelError(f"Sentinel SDK: Job '{job_id}' was cancelled early.")

            time.sleep(interval_sec)

    def get_history(self, page: int = 1, limit: int = 10) -> Dict[str, Any]:
        """
        Retrieves paginated scanning history associated with the workspace.
        """
        return self._request(f"/api/v1/history?page={int(page)}&limit={int(limit)}", method="GET")

    def get_report(self, report_id: str) -> Dict[str, Any]:
        """
        Retrieves a completed intelligence report by its ID.
        """
        if not report_id:
            raise ValueError("Sentinel SDK: A valid report_id is required.")
            
        return self._request(f"/api/v1/reports/{report_id}", method="GET")
