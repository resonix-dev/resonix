# Security Policy

We take the security of Resonix seriously and appreciate responsible disclosures.

## Supported Versions

We release security fixes for the latest minor release. Please upgrade to the most recent version before requesting a fix. If you cannot upgrade, you may still report the issue so we can assess impact.

| Version Range              | Status                                                    |
| -------------------------- | --------------------------------------------------------- |
| Latest (current published) | Actively supported                                        |
| Older versions             | Not actively patched (may receive case‑by‑case backports) |

## Reporting a Vulnerability

Please email the core team at [security@resonix.dev](mailto:security@resonix.dev) with:

- A concise description of the vulnerability
- A proof of concept (code / steps) demonstrating the issue
- Potential impact and any known mitigations
- Whether the issue has been disclosed publicly (it should not be prior to a fix)

You may alternatively open a private security advisory (preferred if GitHub advisories are enabled) instead of a public issue. Avoid including sensitive details in public issues or pull requests.

## Disclosure Process

1. We confirm receipt within 3 business days (usually sooner).
2. We investigate and assess severity (CVSS style qualitative: Low / Moderate / High / Critical).
3. We develop and test a fix, coordinate a release, and may request your help validating.
4. We publish a patched release and a security advisory / changelog entry.
5. We credit the reporter (unless anonymity is requested).

We aim to release fixes within:

- Critical: 7 days
- High: 14 days
- Moderate/Low: Next regular release cycle

If a fix requires more time, we will provide interim guidance (workarounds / mitigation steps) where feasible.

## Out of Scope

The following are generally not treated as security vulnerabilities unless combined with another issue:

- Denial of service via unreasonable configuration or resource exhaustion requiring elevated permissions
- Missing security headers in example code (examples are minimal by design)
- Vulnerabilities in third‑party dependencies with no exploitable path in Resonix

## Safe Harbor

We will not pursue legal action for good‑faith, non‑destructive testing that adheres to this policy, respects user privacy, and does not degrade service.

## Coordinated Disclosure

Please do not publicly disclose or share the issue with others until a fix is released. If you believe the issue presents an imminent risk requiring faster public awareness, contact us and we will discuss accelerated disclosure.

## Cryptography / Sensitive Data

Resonix does not currently handle user credentials or secrets directly. If you discover an issue that could lead to remote code execution or data exfiltration in typical integration scenarios, treat it as high severity.

## Questions

Unsure whether something is a security issue? Reach out anyway at [security@resonix.dev](mailto:security@resonix.dev).

Thank you for helping keep the project and its users safe.
