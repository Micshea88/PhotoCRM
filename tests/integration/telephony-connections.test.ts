import { describe, it, expect } from "vitest"
import { createId } from "@paralleldrive/cuid2"
import type { PoolClient } from "pg"
import { withRawClient } from "../helpers/rls"
import { encrypt, decrypt } from "@/lib/crypto"

/**
 * Telephony Step 1 — table + encryption helper proofs.
 *
 *   (a) RLS isolation — cross-org SELECT returns 0; cross-org INSERT
 *       rejected; positive control. Same shape as companies-rls.test.ts.
 *   (b) Encryption round-trip — decrypt(encrypt(x)) === x; ciphertext
 *       differs from plaintext; two encryptions of the same plaintext
 *       differ (IV randomness); v1: prefix is stable.
 *   (c) Plaintext-not-stored — insert a row through the helper, then
 *       SELECT the three secret columns via raw pg and assert (i) none
 *       equal plaintext, (ii) the plaintext substring does not appear
 *       in any of them, (iii) all begin with the v1: prefix.
 *
 * Raw pg client; app layer bypassed.
 */

async function seedTwoOrgsAndUser(client: PoolClient) {
  const orgA = createId()
  const orgB = createId()
  const userId = createId()
  await client.query(
    `INSERT INTO organization (id, name, slug, created_at)
     VALUES ($1, 'Org A', $2, NOW()), ($3, 'Org B', $4, NOW())`,
    [orgA, `orga-${orgA.slice(0, 8)}`, orgB, `orgb-${orgB.slice(0, 8)}`],
  )
  await client.query(
    `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
     VALUES ($1, 'Test User', $2, true, NOW(), NOW())`,
    [userId, `${userId.slice(0, 8)}@example.com`],
  )
  return { orgA, orgB, userId }
}

function insertConnection(
  client: PoolClient,
  args: {
    orgId: string
    userId: string
    accessTokenCiphertext: string
    refreshTokenCiphertext: string
    validationTokenCiphertext: string | null
  },
) {
  const id = createId()
  const inFiveMinutes = new Date(Date.now() + 5 * 60 * 1000)
  const inSevenDays = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  return client.query(
    `INSERT INTO telephony_connections
       (id, organization_id, user_id, provider, access_token, refresh_token,
        access_token_expires_at, refresh_token_expires_at, scope,
        external_user_id, validation_token)
     VALUES ($1, $2, $3, 'ringcentral', $4, $5, $6, $7,
             'ReadCallLog ReadMessages SMS VoipCalling',
             'rc_ext_12345', $8)`,
    [
      id,
      args.orgId,
      args.userId,
      args.accessTokenCiphertext,
      args.refreshTokenCiphertext,
      inFiveMinutes.toISOString(),
      inSevenDays.toISOString(),
      args.validationTokenCiphertext,
    ],
  )
}

describe("telephony_connections — RLS policy", () => {
  it("hides rows from a probe with a different org context", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB, userId } = await seedTwoOrgsAndUser(client)

      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await insertConnection(client, {
        orgId: orgA,
        userId,
        accessTokenCiphertext: encrypt("access-token-secret-A"),
        refreshTokenCiphertext: encrypt("refresh-token-secret-A"),
        validationTokenCiphertext: null,
      })

      await client.query("SELECT set_config('app.current_org', $1, true)", [orgB])
      const probe = await client.query("SELECT * FROM telephony_connections")
      expect(probe.rows.length).toBe(0)
    })
  })

  it("returns 0 rows when no org context is set (NULL guard)", async () => {
    await withRawClient(async (client) => {
      const { orgA, userId } = await seedTwoOrgsAndUser(client)

      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await insertConnection(client, {
        orgId: orgA,
        userId,
        accessTokenCiphertext: encrypt("access-token-secret-A"),
        refreshTokenCiphertext: encrypt("refresh-token-secret-A"),
        validationTokenCiphertext: null,
      })

      await client.query("SELECT set_config('app.current_org', '', true)")
      const probe = await client.query("SELECT * FROM telephony_connections")
      expect(probe.rows.length).toBe(0)
    })
  })

  it("rejects an INSERT whose organization_id doesn't match app.current_org", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB, userId } = await seedTwoOrgsAndUser(client)

      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await expect(
        insertConnection(client, {
          orgId: orgB,
          userId,
          accessTokenCiphertext: encrypt("access-token-secret-B"),
          refreshTokenCiphertext: encrypt("refresh-token-secret-B"),
          validationTokenCiphertext: null,
        }),
      ).rejects.toThrow(/row-level security|policy/i)
    })
  })

  it("permits same-org reads (positive control)", async () => {
    await withRawClient(async (client) => {
      const { orgA, userId } = await seedTwoOrgsAndUser(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await insertConnection(client, {
        orgId: orgA,
        userId,
        accessTokenCiphertext: encrypt("access-token-secret-A"),
        refreshTokenCiphertext: encrypt("refresh-token-secret-A"),
        validationTokenCiphertext: encrypt("validation-token-secret-A"),
      })

      const probe = await client.query(
        "SELECT provider, scope, external_user_id FROM telephony_connections",
      )
      expect(probe.rows.length).toBe(1)
      expect(probe.rows[0]).toMatchObject({
        provider: "ringcentral",
        scope: "ReadCallLog ReadMessages SMS VoipCalling",
        external_user_id: "rc_ext_12345",
      })
    })
  })
})

describe("telephony — crypto round-trip", () => {
  it("decrypts what it encrypts", () => {
    const plaintext = "rc_access_token_abcdefghijklmnopqrstuvwxyz"
    const ciphertext = encrypt(plaintext)
    expect(decrypt(ciphertext)).toBe(plaintext)
  })

  it("handles unicode + long inputs", () => {
    const unicode = '🎙️ token with emoji + accents éà — and quotes "'
    const long = "x".repeat(8192)
    expect(decrypt(encrypt(unicode))).toBe(unicode)
    expect(decrypt(encrypt(long))).toBe(long)
  })

  it("produces ciphertext that does not equal plaintext", () => {
    const plaintext = "rc_access_token_abcdefghijklmnopqrstuvwxyz"
    expect(encrypt(plaintext)).not.toBe(plaintext)
  })

  it("produces a different ciphertext each call (IV randomness)", () => {
    const plaintext = "rc_access_token_abcdefghijklmnopqrstuvwxyz"
    const a = encrypt(plaintext)
    const b = encrypt(plaintext)
    expect(a).not.toBe(b)
    expect(decrypt(a)).toBe(plaintext)
    expect(decrypt(b)).toBe(plaintext)
  })

  it("emits the v1: forward-compat prefix", () => {
    const blob = encrypt("anything")
    expect(blob.startsWith("v1:")).toBe(true)
  })

  it("refuses ciphertext with an unsupported version prefix", () => {
    const v1 = encrypt("anything")
    const tampered = v1.replace(/^v1:/, "v2:")
    expect(() => decrypt(tampered)).toThrow(/unsupported ciphertext version/i)
  })

  it("refuses tampered ciphertext (auth tag verification)", () => {
    const blob = encrypt("anything")
    // Flip the last byte of the base64 payload — corrupts the
    // ciphertext (auth tag still valid against original bytes, so
    // decrypt() must reject).
    const flipped = blob.slice(0, -2) + (blob.slice(-2, -1) === "A" ? "B" : "A") + blob.slice(-1)
    expect(() => decrypt(flipped)).toThrow()
  })
})

describe("telephony_connections — plaintext is not stored", () => {
  it("stores ciphertext (not plaintext) for all three secret columns", async () => {
    await withRawClient(async (client) => {
      const { orgA, userId } = await seedTwoOrgsAndUser(client)

      // Unique markers so we can substring-search the row for any
      // possible leak.
      const accessPlain = `ACCESS_PLAINTEXT_${createId()}`
      const refreshPlain = `REFRESH_PLAINTEXT_${createId()}`
      const validationPlain = `VALIDATION_PLAINTEXT_${createId()}`

      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await insertConnection(client, {
        orgId: orgA,
        userId,
        accessTokenCiphertext: encrypt(accessPlain),
        refreshTokenCiphertext: encrypt(refreshPlain),
        validationTokenCiphertext: encrypt(validationPlain),
      })

      const probe = await client.query(
        `SELECT access_token, refresh_token, validation_token
         FROM telephony_connections`,
      )
      expect(probe.rows.length).toBe(1)
      const row = probe.rows[0] as {
        access_token: string
        refresh_token: string
        validation_token: string
      }

      // (i) None of the stored values equal the plaintext.
      expect(row.access_token).not.toBe(accessPlain)
      expect(row.refresh_token).not.toBe(refreshPlain)
      expect(row.validation_token).not.toBe(validationPlain)

      // (ii) The plaintext substring does not appear anywhere in the
      // stored values — base64 ciphertext should not contain the raw
      // ASCII markers under any encoding accident.
      expect(row.access_token).not.toContain(accessPlain)
      expect(row.refresh_token).not.toContain(refreshPlain)
      expect(row.validation_token).not.toContain(validationPlain)

      // (iii) Sanity — all begin with the v1: prefix.
      expect(row.access_token.startsWith("v1:")).toBe(true)
      expect(row.refresh_token.startsWith("v1:")).toBe(true)
      expect(row.validation_token.startsWith("v1:")).toBe(true)

      // (iv) Decrypting at the app boundary recovers the plaintext —
      // proves the round-trip is wired end-to-end through the DB.
      expect(decrypt(row.access_token)).toBe(accessPlain)
      expect(decrypt(row.refresh_token)).toBe(refreshPlain)
      expect(decrypt(row.validation_token)).toBe(validationPlain)
    })
  })
})
