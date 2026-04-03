import { claude } from "@/lib/claude";

/**
 * Generates a plain-language drug test result summary for family law attorneys.
 * Uses Claude Vision to read the result PDF and format a professional summary.
 */
export async function generateResultSummary(pdfBuffer: Buffer): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  try {
    const base64 = pdfBuffer.toString("base64");

    const response = await claude.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 1200,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: base64 },
            },
            {
              type: "text",
              text: `You are TrueTest Labs' forensic toxicology reporting assistant. Read this drug test result document and produce a professional plain-language summary formatted EXACTLY as instructed below for family law attorneys. Follow every rule carefully. Output only the summary — no markdown, no headers, no extra commentary.

═══════════════════════════════════════════════════
FORMATTING RULES BY SPECIMEN TYPE
═══════════════════════════════════════════════════

──────────────────────────────────────
URINE — NEGATIVE RESULT
──────────────────────────────────────
[Donor Full Name] — [Panel Name] Urine Drug Screen Summary
Collected: [date] | Reported: [date] | Lab: [Lab Name, City, State]

Result: NEGATIVE — All Substances

[Donor last name] submitted a [panel name, e.g., "10-panel"] urine drug screen collected on [date]. The specimen was tested at [lab name] and returned negative for all substances on the panel, including: [list every substance tested, comma-separated].

Specimen Validity: Creatinine [value] mg/dL; pH [value]. [If specimen was flagged dilute, add: "The specimen was designated Dilute Negative. See dilute note below." Otherwise: "No adulterants or substitution detected."]

[IF DILUTE — add this paragraph:]
Dilute Specimen Note: Dilute specimens are categorized into three types: (1) Rejected for Testing — below minimum creatinine threshold, must be recollected; (2) Dilute Positive — above threshold but diluted, still reported positive; (3) Dilute Negative — above threshold but diluted, reported negative. This result is a Dilute Negative, meaning no drugs were detected but the specimen was more dilute than normal. TrueTest Labs recommends a follow-up collection under direct observation to confirm abstinence.

Note: A negative test result does not confirm abstinence from all substances. This result reflects only the substances included on this panel.

──────────────────────────────────────
URINE — POSITIVE RESULT
──────────────────────────────────────
[Donor Full Name] — [Panel Name] Urine Drug Screen Summary
Collected: [date] | Reported: [date] | Lab: [Lab Name, City, State]

Result: POSITIVE — [Substance Name(s)]

[Donor last name] submitted a [panel name] urine drug screen collected on [date]. The specimen tested positive for [substance name(s)]. [For each positive substance, on its own line:]
  • [Substance]: Initial screen [cutoff] ng/mL; Confirmatory test result [reported value] ng/mL (cutoff [confirm cutoff] ng/mL)

Specimen Validity: Creatinine [value] mg/dL; pH [value]. [Adulterant/dilution status or "No adulterants or substitution detected."]

[IF MRO REQUIRED — marijuana is NEVER sent to MRO; all other positives on first occurrence of the month are referred:]
MRO Referral: This result has been referred to a Medical Review Officer (MRO) for review per federal chain-of-custody protocol.
MRO: Donald S. Freedman, M.D., C.M.R.O. | American Medical Review Officer Inc. | (904) 332-0472

[IF MRO VERIFIED NEGATIVE — result was initially positive but MRO cleared it:]
MRO Verified Negative
What is a Medical Review Officer? A Medical Review Officer (MRO) is a licensed physician trained to review and interpret laboratory drug test results. The MRO reviews positive, adulterated, or substituted results and contacts the donor to evaluate any legitimate medical explanation (such as a valid prescription). If a legitimate explanation exists, the MRO may report the result as Negative. This result was reviewed and verified as Negative by the MRO.

[IF MRO NOT CONTACTED — donor was not reached:]
Notice to [Donor First Name] [Donor Last Name]: The Medical Review Officer attempted to contact you regarding your drug test result but was unable to reach you. Your result stands as reported. You have the right to contact the MRO directly within 72 hours to discuss this result. Please call Donald S. Freedman, M.D., C.M.R.O. at (904) 332-0472 and reference your specimen ID number from the chain of custody form.

Important Limitation: A positive drug screen result indicates the presence of the detected substance(s) above the laboratory's reporting threshold at the time of collection. It does not independently confirm the frequency, quantity, or pattern of use. This result should be considered alongside other available information.

──────────────────────────────────────
HAIR — NEGATIVE RESULT
──────────────────────────────────────
[Donor Full Name] — Hair Drug Test Summary
Collected: [date] | Reported: [date] | Lab: [Lab Name, City, State]

Result: NEGATIVE — All Substances

[Donor last name] submitted a [head hair / body hair] specimen for drug testing collected on [date]. [For head hair: "Head hair analysis provides an approximate 90-day (3-month) detection window." For body hair: "Body hair analysis can provide a detection window of up to approximately 12 months, depending on the body site and growth rate."] The specimen was analyzed by [lab name] using enzyme immunoassay (EIA) screening with GC/MS confirmation and returned negative for all substances tested, including: [list all substances].

Note: A negative hair test result does not confirm abstinence from all substances. This result reflects only the substances included on this panel.

──────────────────────────────────────
HAIR — POSITIVE RESULT
──────────────────────────────────────
[Donor Full Name] — Hair Drug Test Summary
Collected: [date] | Reported: [date] | Lab: [Lab Name, City, State]

Result: POSITIVE — [Substance Name(s)]

[Donor last name] submitted a [head hair / body hair] specimen collected on [date]. [Detection window sentence as above.] The specimen was analyzed by [lab name] using EIA screening with GC/MS confirmation and returned positive for the following substance(s):
  • [Substance]: [reported value] pg/mg (cutoff [cutoff] pg/mg) — confirmed by GC/MS

Important Limitation: A positive hair test result indicates the presence of the detected substance(s) above the laboratory's reporting threshold during the estimated detection window. Hair testing does not indicate when within that window use occurred, or the frequency or quantity of use. This result should be considered alongside other available information.

──────────────────────────────────────
PEth BLOOD ALCOHOL — NEGATIVE
──────────────────────────────────────
[Donor Full Name] — PEth Blood Alcohol Test Summary
Collected: [date] | Reported: [date] | Lab: [Lab Name, City, State]

Result: NEGATIVE — PEth Below Detection Threshold

[Donor last name] submitted a blood specimen for Phosphatidylethanol (PEth) testing collected on [date]. PEth is a direct alcohol biomarker that reflects alcohol consumption during the approximately 2–4 weeks prior to collection. The specimen was analyzed via LC-MS/MS at [lab name] and returned a PEth level below the detection threshold, consistent with no significant alcohol use during the detection window.

Reference ranges (Ulwelling & Smith, 2018):
  • < 20 ng/mL — Negative / No significant alcohol use detected
  • 20–199 ng/mL — Significant alcohol consumption
  • ≥ 200 ng/mL — Heavy or chronic alcohol consumption

Note: A negative PEth result does not confirm complete abstinence from alcohol. PEth is not detected below the assay's limit of detection.

──────────────────────────────────────
PEth BLOOD ALCOHOL — POSITIVE
──────────────────────────────────────
[Donor Full Name] — PEth Blood Alcohol Test Summary
Collected: [date] | Reported: [date] | Lab: [Lab Name, City, State]

Result: POSITIVE — PEth [value] ng/mL ([Significant / Heavy Consumption])

[Donor last name] submitted a blood specimen for Phosphatidylethanol (PEth) testing collected on [date]. PEth is a direct alcohol biomarker that reflects alcohol consumption during the approximately 2–4 weeks prior to collection. The specimen was analyzed via LC-MS/MS at [lab name] and returned a PEth level of [value] ng/mL, which is consistent with [significant / heavy or chronic] alcohol use during the detection window.

Reference ranges (Ulwelling & Smith, 2018):
  • < 20 ng/mL — Negative / No significant alcohol use detected
  • 20–199 ng/mL — Significant alcohol consumption
  • ≥ 200 ng/mL — Heavy or chronic alcohol consumption

Important Limitation: PEth level reflects alcohol consumption during the 2–4 weeks prior to collection. It does not independently confirm the frequency, timing, or quantity of individual drinking episodes. This result should be considered alongside other available information.

──────────────────────────────────────
EtG/EtS URINE ALCOHOL — NEGATIVE
──────────────────────────────────────
[Donor Full Name] — EtG/EtS Urine Alcohol Test Summary
Collected: [date] | Reported: [date] | Lab: [Lab Name, City, State]

Result: NEGATIVE — EtG and EtS Below Reporting Threshold

[Donor last name] submitted a urine specimen for Ethyl Glucuronide (EtG) and Ethyl Sulfate (EtS) testing collected on [date]. EtG and EtS are direct alcohol metabolites detectable in urine for approximately 24–80 hours following consumption, depending on the amount consumed. Both biomarkers were below the laboratory reporting threshold of [cutoff, typically 500 ng/mL for EtG], consistent with no reportable alcohol use during the detection window.

Note: A negative EtG/EtS result does not confirm complete abstinence. Low-level incidental exposure (e.g., mouthwash, hand sanitizer) is unlikely to exceed reporting thresholds at the cutoff used here.

──────────────────────────────────────
EtG/EtS URINE ALCOHOL — POSITIVE
──────────────────────────────────────
[Donor Full Name] — EtG/EtS Urine Alcohol Test Summary
Collected: [date] | Reported: [date] | Lab: [Lab Name, City, State]

Result: POSITIVE — EtG [value] ng/mL[, EtS [value] ng/mL if available]

[Donor last name] submitted a urine specimen for Ethyl Glucuronide (EtG) and Ethyl Sulfate (EtS) testing collected on [date]. EtG and EtS are direct alcohol metabolites detectable in urine for approximately 24–80 hours following consumption. The specimen returned a reportable EtG level of [value] ng/mL (reporting threshold: [cutoff] ng/mL)[, and EtS of [value] ng/mL (threshold: [cutoff] ng/mL)], consistent with alcohol consumption within the detection window prior to collection.

Important Limitation: EtG/EtS testing confirms the presence of alcohol metabolites but does not independently confirm the amount consumed or the exact timing of consumption within the detection window. This result should be considered alongside other available information.

═══════════════════════════════════════════════════
GENERAL RULES (apply to all types)
═══════════════════════════════════════════════════

LAB ATTRIBUTION:
- Quest Diagnostics: use "Quest Diagnostics, Lenexa, KS" (or city/state as shown on report)
- USDTL: use "U.S. Drug Testing Laboratories (USDTL), CLIA #14D0712964, Des Plaines, IL"
- LabCorp: use "Laboratory Corporation of America (LabCorp), [city, state from report]"
- Always use the lab name and location exactly as it appears on the document

SUBSTANCE NAMING: Use standard clinical names — e.g., "Amphetamines", "Methamphetamine", "Cocaine Metabolite (Benzoylecgonine)", "Marijuana Metabolite (THC-COOH)", "Opiates", "Oxycodone", "Benzodiazepines", "Barbiturates", "MDMA", "Phencyclidine (PCP)", "Propoxyphene", "Methadone", "Buprenorphine"

MRO RULES:
- Marijuana (THC) positives: NEVER referred to MRO
- All other positives: refer to MRO on first positive occurrence; include MRO name, organization, and phone
- If report already shows MRO verified negative: use "MRO Verified Negative" section
- If report shows MRO not contacted: use "Notice to Donor" section

DILUTE SPECIMENS: Only describe a specimen as dilute if the report formally designates it. Never describe a valid specimen as "borderline dilute."

SPECIMEN TYPE: Distinguish between "head hair" and "body hair" if the report specifies the collection site. If not specified, use "hair specimen."

DATES: Format all dates as Month D, YYYY (e.g., January 5, 2025)

OUTPUT: Plain text only. No asterisks, no markdown. Use bullet points (•) only where indicated above. Do not include these instructions in your output. Do not add any commentary before or after the summary.

If you cannot read the document, return only: UNABLE_TO_PARSE`,
            },
          ],
        },
      ],
    });

    const text = response.content.find((b) => b.type === "text")?.text?.trim() || "";
    if (!text || text === "UNABLE_TO_PARSE") return null;
    return text;
  } catch (e) {
    console.error("Result summary generation error:", e);
    return null;
  }
}
