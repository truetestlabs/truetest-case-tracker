import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding test catalog...");

  // Clear existing catalog
  await prisma.testCatalog.deleteMany();

  const tests = [
    // ============================================================
    // URINE PANELS — CRL/Quest
    // ============================================================
    { category: "Urine", testName: "5 Panel Urine Non-DOT", panelSize: "5 panel", specimenType: "urine" as const, lab: "crl_quest" as const, labTestCode: "P705", clientPrice: 75, labCost: 0, description: "Can be ordered at Quest PSCs" },
    { category: "Urine", testName: "5 Panel with EtG", panelSize: "5 panel", specimenType: "urine" as const, lab: "crl_quest" as const, labTestCode: "N060+P705", clientPrice: 155, labCost: 0, description: "Can be ordered at Quest PSCs" },
    { category: "Urine", testName: "7 Panel Urine", panelSize: "7 panel", specimenType: "urine" as const, lab: "crl_quest" as const, labTestCode: "P707", clientPrice: 77, labCost: 0 },
    { category: "Urine", testName: "9 Panel Urine", panelSize: "9 panel", specimenType: "urine" as const, lab: "crl_quest" as const, labTestCode: "P711", clientPrice: 80, labCost: 0 },
    { category: "Urine", testName: "10 Panel Urine", panelSize: "10 panel", specimenType: "urine" as const, lab: "crl_quest" as const, labTestCode: "P710", clientPrice: 95, labCost: 0, description: "Can be ordered at Quest PSCs" },
    { category: "Urine", testName: "10 Panel Expanded Opiates", panelSize: "10 panel", specimenType: "urine" as const, lab: "quest" as const, labTestCode: "35639N", clientPrice: 105, labCost: 0, description: "Can be ordered at Quest PSCs" },
    { category: "Urine", testName: "10 Panel with Fentanyl", panelSize: "10 panel", specimenType: "urine" as const, lab: "crl_quest" as const, labTestCode: "P71+K462 / Quest 59387N", clientPrice: 115, labCost: 0, description: "Can be ordered at Quest PSCs" },
    { category: "Urine", testName: "10 Panel with EtG Urine", panelSize: "10 panel", specimenType: "urine" as const, lab: "crl_quest" as const, labTestCode: "P710+N060", clientPrice: 175, labCost: 0, description: "Can be ordered at Quest PSCs" },
    { category: "Urine", testName: "OPI/6AM/BUP/FENT/MEP/TRAM/KET", panelSize: "custom", specimenType: "urine" as const, lab: "quest" as const, labTestCode: "37209N", clientPrice: 165, labCost: 0 },
    { category: "Urine", testName: "Steroid Panel", panelSize: "custom", specimenType: "urine" as const, lab: "quest" as const, labTestCode: "21791N", clientPrice: 275, labCost: 0, description: "Can be ordered at Quest PSCs" },

    // URINE PANELS — USDTL
    { category: "Urine", testName: "12 Panel Urine (Meperidine & Tramadol)", panelSize: "12 panel", specimenType: "urine" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 245, labCost: 61 },
    { category: "Urine", testName: "14 Panel Urine (Fentanyl & Sufentanil)", panelSize: "14 panel", specimenType: "urine" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 255, labCost: 82 },
    { category: "Urine", testName: "15 Panel Urine (Buprenorphine)", panelSize: "15 panel", specimenType: "urine" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 260, labCost: 93 },
    { category: "Urine", testName: "16 Panel Urine (Carisoprodol/Soma)", panelSize: "16 panel", specimenType: "urine" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 290, labCost: 104 },
    { category: "Urine", testName: "17 Panel Urine (Zolpidem/Ambien)", panelSize: "17 panel", specimenType: "urine" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 305, labCost: 113 },
    { category: "Urine", testName: "18 Panel Urine (EtG/EtS)", panelSize: "18 panel", specimenType: "urine" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 325, labCost: 124 },

    // URINE ADD-ONS — USDTL
    { category: "Urine Add-On", testName: "Urine 6-MAM (add-on)", panelSize: null, specimenType: "urine" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 100, labCost: 52, isAddOn: true },
    { category: "Urine Add-On", testName: "Urine Confirmations (per drug class)", panelSize: null, specimenType: "urine" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 75, labCost: 30, isAddOn: true },
    { category: "Urine Add-On", testName: "Urine Dextromethorphan (add-on)", panelSize: null, specimenType: "urine" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 85, labCost: 39, isAddOn: true },
    { category: "Urine Add-On", testName: "Urine Dextromethorphan (stand-alone)", panelSize: null, specimenType: "urine" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 160, labCost: 79 },
    { category: "Urine Add-On", testName: "Urine EtG/EIA", panelSize: null, specimenType: "urine" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 80, labCost: 30 },
    { category: "Urine Add-On", testName: "Urine EtG/EtS", panelSize: null, specimenType: "urine" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 130, labCost: 61 },
    { category: "Urine Add-On", testName: "Urine Gabapentin (add-on)", panelSize: null, specimenType: "urine" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 85, labCost: 39, isAddOn: true },
    { category: "Urine Add-On", testName: "Urine Gabapentin (stand-alone)", panelSize: null, specimenType: "urine" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 160, labCost: 79 },
    { category: "Urine Add-On", testName: "Urine Mitragynine/Kratom (stand-alone)", panelSize: null, specimenType: "urine" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 80, labCost: 32 },
    { category: "Urine Add-On", testName: "Urine Propofol Glucuronide", panelSize: null, specimenType: "urine" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 80, labCost: 30 },
    { category: "Urine Add-On", testName: "Urine Psilocin/Mushrooms (add-on)", panelSize: null, specimenType: "urine" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 85, labCost: 39, isAddOn: true, specialHandling: "Protect from light (wrap in foil). Ship chilled with ice pack. If not shipped within 3 days, freeze specimen." },
    { category: "Urine Add-On", testName: "Urine Psilocin/Mushrooms (stand-alone)", panelSize: null, specimenType: "urine" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 160, labCost: 79, specialHandling: "Protect from light (wrap in foil). Ship chilled with ice pack. If not shipped within 3 days, freeze specimen." },

    // ============================================================
    // HAIR/NAIL PANELS — USDTL
    // ============================================================
    { category: "Hair/Nail", testName: "5 Panel Hair/Nails", panelSize: "5 panel", specimenType: "hair" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 295, labCost: 79, description: "Can be ordered at Quest PSCs" },
    { category: "Hair/Nail", testName: "5 Panel with EtG Hair/Nails", panelSize: "5 panel", specimenType: "hair" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 425, labCost: 135 },
    { category: "Hair/Nail", testName: "EtG Hair/Nails (stand-alone)", panelSize: null, specimenType: "hair" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 275, labCost: 105 },
    { category: "Hair/Nail", testName: "7 Panel Hair/Nails", panelSize: "7 panel", specimenType: "hair" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 205, labCost: 99, description: "5 panel plus Barbiturates, Benzodiazepines" },
    { category: "Hair/Nail", testName: "10 Panel Hair/Nails", panelSize: "10 panel", specimenType: "hair" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 365, labCost: 147, description: "Amphetamines, Marijuana, Cocaine, Opiates, PCP, Benzodiazepines, Barbiturates, Methadone, Propoxyphene, Oxycodone" },
    { category: "Hair/Nail", testName: "10 Panel with Psilocin Hair/Nail", panelSize: "10 panel", specimenType: "hair" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 515, labCost: 0 },
    { category: "Hair/Nail", testName: "12 Panel Hair/Nails (Meperidine & Tramadol)", panelSize: "12 panel", specimenType: "hair" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 410, labCost: 199 },
    { category: "Hair/Nail", testName: "13 Panel Hair/Nails (Fentanyl)", panelSize: "13 panel", specimenType: "hair" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 455, labCost: 236 },
    { category: "Hair/Nail", testName: "14 Panel Hair/Nails (Sufentanil)", panelSize: "14 panel", specimenType: "hair" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 495, labCost: 249 },
    { category: "Hair/Nail", testName: "15 Panel Hair/Nails (Ketamine)", panelSize: "15 panel", specimenType: "hair" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 600, labCost: 308 },
    { category: "Hair/Nail", testName: "16 Panel Hair/Nails (Buprenorphine)", panelSize: "16 panel", specimenType: "hair" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 625, labCost: 318 },
    { category: "Hair/Nail", testName: "17 Panel Hair/Nails (Zolpidem)", panelSize: "17 panel", specimenType: "hair" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 650, labCost: 320 },
    { category: "Hair/Nail", testName: "18 Panel Hair/Nails (Kratom/Mitragynine)", panelSize: "18 panel", specimenType: "hair" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 675, labCost: 328 },
    { category: "Hair/Nail", testName: "19 Panel Hair/Nails (Gabapentin)", panelSize: "19 panel", specimenType: "hair" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 700, labCost: 335 },
    { category: "Hair/Nail", testName: "20 Panel Hair/Nails (Xylazine)", panelSize: "20 panel", specimenType: "hair" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 825, labCost: 404 },

    // HAIR/NAIL ADD-ONS — USDTL
    { category: "Hair/Nail Add-On", testName: "Hair/Nails Cotinine (add-on)", panelSize: null, specimenType: "hair" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 120, labCost: 55, isAddOn: true },
    { category: "Hair/Nail Add-On", testName: "Hair/Nails Cotinine (stand-alone)", panelSize: null, specimenType: "hair" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 225, labCost: 105 },
    { category: "Hair/Nail Add-On", testName: "Hair/Nails EtG (add-on)", panelSize: null, specimenType: "hair" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 130, labCost: 56, isAddOn: true },
    { category: "Hair/Nail Add-On", testName: "Hair/Nails EtG (stand-alone)", panelSize: null, specimenType: "hair" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 275, labCost: 105 },
    { category: "Hair/Nail Add-On", testName: "Hair/Nails Fentanyl (add-on)", panelSize: null, specimenType: "hair" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 130, labCost: 56, isAddOn: true },
    { category: "Hair/Nail Add-On", testName: "Hair/Nails Fentanyl (stand-alone)", panelSize: null, specimenType: "hair" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 225, labCost: 99 },
    { category: "Hair/Nail Add-On", testName: "Hair/Nails Gabapentin (add-on)", panelSize: null, specimenType: "hair" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 130, labCost: 56, isAddOn: true },
    { category: "Hair/Nail Add-On", testName: "Hair/Nails Gabapentin (stand-alone)", panelSize: null, specimenType: "hair" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 225, labCost: 107 },
    { category: "Hair/Nail Add-On", testName: "Hair/Nails Kratom/Mitragynine (add-on)", panelSize: null, specimenType: "hair" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 130, labCost: 56, isAddOn: true },
    { category: "Hair/Nail Add-On", testName: "Hair/Nails Kratom/Mitragynine (stand-alone)", panelSize: null, specimenType: "hair" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 225, labCost: 107 },
    { category: "Hair/Nail Add-On", testName: "Hair/Nails Psilocin/Mushrooms (add-on)", panelSize: null, specimenType: "hair" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 130, labCost: 56, isAddOn: true },
    { category: "Hair/Nail Add-On", testName: "Hair/Nails Psilocin/Mushrooms (stand-alone)", panelSize: null, specimenType: "hair" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 225, labCost: 107 },
    { category: "Hair/Nail Add-On", testName: "Hair/Nails Xylazine (add-on)", panelSize: null, specimenType: "hair" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 130, labCost: 56, isAddOn: true },
    { category: "Hair/Nail Add-On", testName: "Hair/Nails Xylazine (stand-alone)", panelSize: null, specimenType: "hair" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 225, labCost: 107 },
    { category: "Hair/Nail Add-On", testName: "Hair/Nails Medetomidine (add-on)", panelSize: null, specimenType: "hair" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 130, labCost: 56, isAddOn: true },
    { category: "Hair/Nail Add-On", testName: "Hair/Nails Medetomidine (stand-alone)", panelSize: null, specimenType: "hair" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 225, labCost: 107 },
    { category: "Hair/Nail Add-On", testName: "Hair/Nails Phenibut (add-on)", panelSize: null, specimenType: "hair" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 130, labCost: 56, isAddOn: true },
    { category: "Hair/Nail Add-On", testName: "Hair/Nails Phenibut (stand-alone)", panelSize: null, specimenType: "hair" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 225, labCost: 107 },
    { category: "Hair/Nail Add-On", testName: "Hair/Nails Tianeptine (add-on)", panelSize: null, specimenType: "hair" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 130, labCost: 56, isAddOn: true },
    { category: "Hair/Nail Add-On", testName: "Hair/Nails Tianeptine (stand-alone)", panelSize: null, specimenType: "hair" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 225, labCost: 107 },
    { category: "Hair/Nail Add-On", testName: "Hair/Nails Diphenhydramine", panelSize: null, specimenType: "hair" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 175, labCost: 83 },
    { category: "Hair/Nail Add-On", testName: "Hair/Nails High-Potency Opioids (HPOs)", panelSize: null, specimenType: "hair" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 175, labCost: 83 },
    { category: "Hair/Nail Add-On", testName: "Hair/Nails Propofol Glucuronide", panelSize: null, specimenType: "hair" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 400, labCost: 205 },
    { category: "Hair/Nail Add-On", testName: "Hair Methamphetamine Isomers (D/L)", panelSize: null, specimenType: "hair" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 750, labCost: 405 },
    { category: "Hair/Nail Add-On", testName: "Hair/Nails Delta 9-THCP/Delta 8-THCP/HHC/CBDP (add-on)", panelSize: null, specimenType: "hair" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 130, labCost: 56, isAddOn: true, description: "ChildGuard compatible" },
    { category: "Hair/Nail Add-On", testName: "Hair/Nails Delta 9-THCP/Delta 8-THCP/HHC/CBDP (stand-alone)", panelSize: null, specimenType: "hair" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 225, labCost: 107, description: "ChildGuard compatible" },

    // ============================================================
    // CHILDGUARD ENVIRONMENTAL EXPOSURE — USDTL
    // ============================================================
    { category: "ChildGuard", testName: "ChildGuard 5 Panel (Environmental Exposure)", panelSize: "5 panel", specimenType: "hair" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 195, labCost: 79, description: "Amphetamines, Marijuana, Cocaine, Opiates, PCP. Detects passive exposure via native drugs AND metabolites." },
    { category: "ChildGuard", testName: "ChildGuard 7 Panel (Environmental Exposure)", panelSize: "7 panel", specimenType: "hair" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 225, labCost: 99, description: "5 panel plus Benzodiazepines, Barbiturates" },
    { category: "ChildGuard", testName: "ChildGuard 9 Panel (Environmental Exposure)", panelSize: "9 panel", specimenType: "hair" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 300, labCost: 135, description: "7 panel plus Methadone, Propoxyphene" },

    // ============================================================
    // BLOOD TESTS
    // ============================================================
    { category: "Blood", testName: "PEth - Phosphatidylethanol (Blood/Blood Spot)", panelSize: null, specimenType: "blood" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 295, labCost: 105, description: "Binge drinking biomarker test" },
    { category: "Blood", testName: "10 Panel Blood (Test Code 8096B)", panelSize: "10 panel", specimenType: "blood" as const, lab: "nms" as const, labTestCode: "8096B", clientPrice: 650, labCost: 0, description: "No 5 panel available for blood" },

    // ============================================================
    // INSTANT/RAPID TESTS — In-House
    // ============================================================
    { category: "Instant", testName: "5 Panel Instant Urine", panelSize: "5 panel", specimenType: "urine" as const, lab: "truetest_inhouse" as const, labTestCode: "ERO5/ERO6", clientPrice: 65, labCost: 0, description: "ERO5 no THC, ERO6 includes THC. Can be ordered at Quest PSCs" },
    { category: "Instant", testName: "10 Panel Instant Urine", panelSize: "10 panel", specimenType: "urine" as const, lab: "truetest_inhouse" as const, labTestCode: null, clientPrice: 85, labCost: 0, description: "Can be ordered at Quest PSCs" },
    { category: "Instant", testName: "10 Panel Instant Oral Fluid", panelSize: "10 panel", specimenType: "oral_fluid" as const, lab: "truetest_inhouse" as const, labTestCode: null, clientPrice: 85, labCost: 0 },

    // ============================================================
    // BREATH ALCOHOL — In-House
    // ============================================================
    { category: "Breath Alcohol", testName: "Breath Alcohol Test (BAT)", panelSize: null, specimenType: "breath" as const, lab: "truetest_inhouse" as const, labTestCode: null, clientPrice: 65, labCost: 0 },

    // ============================================================
    // SWEAT PATCH
    // ============================================================
    { category: "Sweat Patch", testName: "Sweat Patch Testing", panelSize: null, specimenType: "sweat_patch" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 150, labCost: 0, description: "Can be worn up to 7 days, new patch applied" },

    // ============================================================
    // SPECIALTY — Expertox
    // ============================================================
    { category: "Specialty", testName: "Unknown Substance Urine (with GHB)", panelSize: null, specimenType: "urine" as const, lab: "expertox" as const, labTestCode: null, clientPrice: 1050, labCost: 0 },
    { category: "Specialty", testName: "Unknown Substance Urine (without GHB)", panelSize: null, specimenType: "urine" as const, lab: "expertox" as const, labTestCode: null, clientPrice: 770, labCost: 0 },
    { category: "Specialty", testName: "Unknown Substance Hair (with GHB)", panelSize: null, specimenType: "hair" as const, lab: "expertox" as const, labTestCode: null, clientPrice: 1100, labCost: 0 },
    { category: "Specialty", testName: "Unknown Substance Hair (without GHB)", panelSize: null, specimenType: "hair" as const, lab: "expertox" as const, labTestCode: null, clientPrice: 800, labCost: 0 },
    { category: "Specialty", testName: "Mushroom Only (Hair)", panelSize: null, specimenType: "hair" as const, lab: "expertox" as const, labTestCode: null, clientPrice: 780, labCost: 0 },
    { category: "Specialty", testName: "Hallucinogenic Panel (LSD, Mushroom, PCP)", panelSize: null, specimenType: "hair" as const, lab: "expertox" as const, labTestCode: null, clientPrice: 900, labCost: 0 },
    { category: "Specialty", testName: "GHB (Hair)", panelSize: null, specimenType: "hair" as const, lab: "expertox" as const, labTestCode: null, clientPrice: 350, labCost: 0 },
    { category: "Specialty", testName: "Unknown Substance/Date Rape Panel (without GHB)", panelSize: null, specimenType: "hair" as const, lab: "expertox" as const, labTestCode: null, clientPrice: 800, labCost: 0, description: "GHB needs to be added on separately" },

    // ============================================================
    // RETEST/MISC — USDTL
    // ============================================================
    { category: "Miscellaneous", testName: "Retest/Reanalysis (per drug analyte)", panelSize: null, specimenType: "urine" as const, lab: "usdtl" as const, labTestCode: null, clientPrice: 200, labCost: 105 },

    // ============================================================
    // SEMEN / INFIDELITY — Medipro
    // ============================================================
    { category: "Forensic", testName: "Semen Detection", panelSize: null, specimenType: "semen" as const, lab: "medipro" as const, labTestCode: null, clientPrice: 250, labCost: 0 },
    { category: "Forensic", testName: "Infidelity Male/Female", panelSize: null, specimenType: "semen" as const, lab: "medipro" as const, labTestCode: null, clientPrice: 330, labCost: 0 },
    { category: "Forensic", testName: "Infidelity Comparison (from sample taken)", panelSize: null, specimenType: "semen" as const, lab: "medipro" as const, labTestCode: null, clientPrice: 180, labCost: 0 },
  ];

  for (const test of tests) {
    await prisma.testCatalog.create({
      data: {
        category: test.category,
        testName: test.testName,
        panelSize: test.panelSize ?? null,
        specimenType: test.specimenType,
        lab: test.lab,
        labTestCode: test.labTestCode ?? null,
        clientPrice: test.clientPrice,
        labCost: test.labCost,
        description: test.description ?? null,
        specialHandling: test.specialHandling ?? null,
        isAddOn: test.isAddOn ?? false,
        active: true,
      },
    });
  }

  console.log(`Seeded ${tests.length} test catalog entries`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
