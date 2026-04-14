# USDTL Discovery Call — One-Pager

**Goal of this call:** Confirm USDTL will send HL7 v2 ORU^R01 messages with embedded PDFs to an HTTPS endpoint we host, and gather the technical details we need to build the receiver. Walk away with answers to the 6 questions below and a sandbox to test against.

---

## What we're asking for (in plain English)

A direct API connection where:
- USDTL **POSTs HL7 v2 messages** to an endpoint on our case tracker
- Each message contains the **lab result data** AND the **result PDF embedded** in the message
- Our system parses the message, matches it back to the right test order, and updates the case automatically

This replaces today's manual workflow of staff downloading PDFs and uploading them by hand.

---

## The 6 questions to ask (read them off this page)

1. **"What HL7 version and message type will you send — is it ORU^R01 over HTTPS POST?"**
   - Listening for: "Yes, ORU^R01" or "ORU^R30" (a newer variant). Either works.

2. **"Will embedded PDFs come in an ED segment, and are they base64-encoded?"**
   - Listening for: "Yes, ED segment, base64." That's standard.

3. **"What field should I use as the match key for accession number — OBR-2 or OBR-3? And will you let us specify it at order time, or do you assign it?"**
   - This is the most important answer of the call. Whichever they say, write it down.
   - If **they assign it**: we have to wait for their first message before we can match — affects our schema design.
   - If **we specify it**: we generate the accession at order creation and hand it to them on the requisition form.

4. **"How do you authenticate the webhook — HMAC-SHA256 with a shared secret, mutual TLS, or an IP allowlist?"**
   - Most labs do HMAC-SHA256 with a shared secret. IP allowlist is also fine.
   - Get whatever they offer in writing — secret will be exchanged out-of-band.

5. **"What ACK format do you expect back, and what timeout before you retry?"**
   - Listening for: "Standard MSH/MSA ACK, timeout 30 seconds, retry 3 times."
   - This tells us how forgiving they are if our endpoint blips.

6. **"Do you have a test/sandbox environment with sample messages we can build against before going live?"**
   - This is non-negotiable. We will not point production at this until we've tested in their sandbox.

---

## Things to confirm before hanging up

- [ ] Sandbox endpoint URL and credentials promised
- [ ] Sample HL7 messages will be sent (ask for at least 3: a clean negative, a positive, and one with multiple analytes)
- [ ] Spec doc / interface guide will be emailed
- [ ] Technical contact name + email for follow-up questions
- [ ] Rough timeline they expect on their side (some labs need internal scheduling)
- [ ] Any cost — most labs offer this free, but ask

---

## Things to NOT commit to on the call

- ❌ A specific go-live date
- ❌ Which version of HL7 we'll target without checking the spec
- ❌ Whether we can support any specific feature ("can you handle XYZ?") — answer: *"Let me confirm with my dev team and follow up by email."*
- ❌ Production endpoint URL — we don't even have one built yet

---

## Safe deflection phrases

- *"Let me circle back with my dev team on that and get back to you."*
- *"Can you send over the spec doc so we can build against it?"*
- *"I'll confirm the exact implementation on our side and follow up by email."*
- For acronyms: *"What does that stand for?"*

---

## After the call

1. **Send a recap email within 24 hours** confirming what was agreed. Template:
   > Hi [name], thanks for the call today. Quick recap of what we discussed:
   > - HL7 version/message type: [their answer]
   > - Authentication method: [their answer]
   > - Accession number assignment: [we specify / they assign]
   > - Sandbox access: [details promised]
   > - Next step: [what they're sending us / when we follow up]
   > Let me know if I missed anything.

2. **Forward the call recording (or notes) to Claude** — paste it into a chat and we'll translate every answer and turn it into the next plan.

3. **Don't touch the schema or webhook code yet** — Phase 2 of the cleanup plan is gated on the answer to question 3 above.

---

**The single most important thing:** Record the call (with permission), and don't try to retain anything live. You're there to ask the 6 questions, write down the answers, and look thoughtful. That's it.
