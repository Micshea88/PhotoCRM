# Pathway Tokenized Resource Rule (V1 locked, research-backed)

Based on OWASP Session Management Cheat Sheet, OWASP Secure Coding Practices, NIST SP 800-57 (Key Management), Azure Key Vault and AWS KMS architecture documentation, this rule governs all user-facing tokenized URLs and stored credentials in Pathway.

## 1. Random tokens, never derived

All user-facing tokenized URLs (share links, magic links, deep links, Smart Document links, future invitation links) MUST use cryptographically random tokens (≥128 bits) stored in the database. NEVER derive tokens from server secrets, user IDs, timestamps, or any rotatable value.

## 2. Per-entry salts on credential hashes

Stored credential hashes (passcodes, future API keys, future password hashes outside Better Auth's domain) MUST use per-entry salts with a vetted algorithm (scrypt, argon2id, or bcrypt). NEVER use server-wide peppers that would couple hash validity to a rotatable secret.

## 3. Graceful rotation on session secrets

Session signing secrets (HMAC cookies, CSRF tokens, etc.) MAY be derived from server configuration, but MUST support graceful rotation via comma-separated environment variable values: sign new tokens with the first secret, verify tokens against ANY listed secret. Document each session secret's rotation impact in a code comment at its declaration.

## 4. Envelope encryption for application-layer at-rest encryption

If any stored credential or PII ever needs application-layer encryption beyond the database's at-rest encryption, use the envelope pattern: per-row Data Encryption Key (DEK) encrypts the data; a Key Encryption Key (KEK) encrypts the DEK. KEK rotation re-wraps DEKs only — never re-encrypts the underlying data. This pattern is used by AWS KMS, Azure Key Vault, and Google Cloud KMS.

## 5. Document deviations

Any code that deviates from rules 1-4 MUST add an inline comment with reasoning AND update this file with a "Known Exceptions" section.

## Known V1 design choices (not deviations):

- file_share_links.passcode_plaintext is NOT application-layer encrypted in V1. Postgres at-rest encryption (Neon-managed) is the security boundary. Plaintext is photographer-recoverable via regeneration if needed. Revisit if compliance (PCI DSS, SOC 2, HIPAA) requires application-layer encryption — solution at that point is to add envelope encryption per rule 4, which is non-destructive.
