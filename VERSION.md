# Version Information - Sentinel API

This document details the current release version parameters, architectural release lifecycle phase, known system limitations, and upcoming targets.

---

## 🚀 Current Release Candidate

- **Name**: Sentinel API Intelligence Platform
- **Version**: `1.0.0-rc.1`
- **Release Lifecycle Phase**: Release Candidate 1

The platform is currently undergoing final quality assurance, regression validation, and performance test sweeps. 

---

## ⚠️ Known Limitations

1. **In-Memory Volatility**:
   - The primary gateway currently maintains active API keys, historical scans, and rate limiter windows in-memory. Restarting the server container will reset transient metadata. Note that the architecture is fully prepared with validation checks to allow immediate conversion to direct cloud databases or relational Postgres connections.
2. **Rate Limiting Scope**:
   - The current distributed rate limiter relies on local synchronization loops. Under highly multi-node, horizontally autoscaled load environments, the windows are isolated per-node until connected to an external backing redis/cache server.
3. **External API Failures**:
   - If upstream external threat databases or network resources are offline, the corresponding connectors fallback to local resilience logic, wrapping the result as a secure fallback metadata card. This gracefully protects the overall pipeline stability but may limit data depth during upstream maintenance.

---

## 🎯 Upcoming v1.0 Goals

1. **Persistent Backing Layer**:
   - Integrate a permanent cloud-backed state persistence system (such as Firebase Firestore or Cloud SQL) to eliminate container-restart session resets.
2. **Centralized Key Rotation**:
   - Transition API key rotation and secret signing to automated Secret Manager systems (e.g., Google Secret Manager) to bolster enterprise security controls.
3. **Advanced Connection Pools**:
   - Implement structured keep-alive connection reuse inside external REST connectors to reduce HTTPS handshake latency on subsequent scan queries.
