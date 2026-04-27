import { NextRequest, NextResponse } from "next/server";

// Lazy import — pdf-parse doesn't have a proper ESM default export
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdf = require("pdf-parse");

function parseCourtOrderText(text: string) {
  const fullText = text;
  const upperText = text.toUpperCase();

  // Extract court case number
  let courtCaseNumber = "";
  const caseNoMatch = fullText.match(/(?:Case\s*No\.?|No\.)\s*([\w\d]+)/i)
    || fullText.match(/(20\d{2}[A-Z]\d{5,})/);
  if (caseNoMatch) courtCaseNumber = caseNoMatch[1];

  // Extract county
  let county = "Cook County";
  const countyMatch = fullText.match(/(\w+)\s+COUNTY/i);
  if (countyMatch) county = countyMatch[1].charAt(0).toUpperCase() + countyMatch[1].slice(1).toLowerCase() + " County";

  // Extract judge
  let judgeName = "";
  const judgeMatch = fullText.match(/Judge\s+([A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+(?:[- ]\d+)?)/i)
    || fullText.match(/JUDGE[:\s]*\n?\s*([^\n]+)/i)
    || fullText.match(/ENTERED.*?Judge\s+([^\n]+)/is);
  if (judgeMatch) judgeName = judgeMatch[1].trim().replace(/[-]\d+$/, "").trim();

  // Extract order date
  let orderDate = "";
  const datePatterns = [
    /ENTERED[:\s]*(\w+\s+\d{1,2},?\s+\d{4})/i,
    /(?:ENTER|ENTERED)[:\s]*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    /(?:MAR|FEB|JAN|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+\d{1,2}\s*,?\s*\d{4}/i,
    /(\d{1,2}\/\d{1,2}\/\d{2,4})/,
  ];
  for (const pattern of datePatterns) {
    const match = fullText.match(pattern);
    if (match) {
      const dateStr = match[1] || match[0];
      const d = new Date(dateStr);
      if (!isNaN(d.getTime())) { orderDate = d.toISOString().split("T")[0]; break; }
    }
  }

  // Extract ALL names that appear before "Petitioner" or "Respondent"
  const donors: Array<{
    firstName: string; lastName: string; email: string; phone: string; party: string;
  }> = [];

  // Petitioner - look for name patterns
  const petPatterns = [
    /([A-Z][A-Z\s.]+),?\s*\n\s*Petitioner/m,
    /Petitioner[,:]\s*\n?\s*([A-Z][A-Z\s.]+)/m,
    /IN\s+RE.*?(?:MARRIAGE|MATTER)\s+OF[:\s]*\n?\s*([A-Z][A-Z\s.]+),?\s*\n/im,
  ];
  for (const pat of petPatterns) {
    const match = fullText.match(pat);
    if (match) {
      const rawName = match[1].replace(/,/g, "").replace(/\s+/g, " ").trim();
      const parts = rawName.split(" ").filter(Boolean);
      if (parts.length >= 2) {
        const firstName = parts[0].charAt(0) + parts[0].slice(1).toLowerCase();
        const lastName = parts[parts.length - 1].charAt(0) + parts[parts.length - 1].slice(1).toLowerCase();

        // Look for email near petitioner
        let email = "";
        const petEmailMatch = fullText.match(new RegExp(parts[0] + ".*?([\\w.+-]+@[\\w.-]+\\.\\w+)", "is"));
        if (petEmailMatch) email = petEmailMatch[1];

        // Look for phone
        let phone = "";
        const petPhoneMatch = fullText.match(new RegExp(parts[0] + ".*?\\(?\\d{3}\\)?[\\s.-]*\\d{3}[\\s.-]*\\d{4}", "is"));
        if (petPhoneMatch) {
          const ph = petPhoneMatch[0].match(/\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}/);
          if (ph) phone = ph[0];
        }

        donors.push({ firstName, lastName, email, phone, party: "petitioner" });
        break;
      }
    }
  }

  // Respondent
  const respPatterns = [
    /([A-Z][A-Z\s.]+),?\s*\n\s*Respondent/m,
    /Respondent[,:]\s*\n?\s*([A-Z][A-Z\s.]+)/m,
  ];
  for (const pat of respPatterns) {
    const match = fullText.match(pat);
    if (match) {
      const rawName = match[1].replace(/,/g, "").replace(/\s+/g, " ").trim();
      const parts = rawName.split(" ").filter(Boolean);
      if (parts.length >= 2) {
        const firstName = parts[0].charAt(0) + parts[0].slice(1).toLowerCase();
        const lastName = parts[parts.length - 1].charAt(0) + parts[parts.length - 1].slice(1).toLowerCase();

        let email = "";
        const respEmailMatch = fullText.match(new RegExp("(?:Respondent|" + parts[parts.length - 1] + ").*?([\\w.+-]+@[\\w.-]+\\.\\w+)", "is"));
        if (respEmailMatch) email = respEmailMatch[1];

        let phone = "";
        const respPhoneMatch = fullText.match(new RegExp("(?:Respondent|" + parts[parts.length - 1] + ").*?\\(?\\d{3}\\)?[\\s.-]*\\d{3}[\\s.-]*\\d{4}", "is"));
        if (respPhoneMatch) {
          const ph = respPhoneMatch[0].match(/\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}/);
          if (ph) phone = ph[0];
        }

        donors.push({ firstName, lastName, email, phone, party: "respondent" });
        break;
      }
    }
  }

  // Extract contacts (attorneys, GALs)
  const contacts: Array<{
    firstName: string; lastName: string; firmName: string; email: string; phone: string;
    type: string; role: string; represents: string; barNumber: string;
    receivesResults: boolean; receivesStatus: boolean; receivesInvoices: boolean; canOrderTests: boolean;
  }> = [];

  // Find all email addresses
  const allEmails = [...new Set(fullText.match(/[\w.+-]+@[\w.-]+\.\w+/g) || [])];

  // Attorney block
  const attorneyNameMatch = fullText.match(/Attorney\s+Name\s+([^\n]+)/i);
  const firmNameMatch = fullText.match(/Firm\s+Name\s+([^\n]+)/i);
  const firmPhoneMatch = fullText.match(/Firm\s+Phone\s+([^\n]+)/i);
  const attorneyForMatch = fullText.match(/Attorney\s+for\s+([^\n]+)/i);
  const barNumberMatch = fullText.match(/Attorney\s+No\.?\s*(\d+)/i);

  if (attorneyNameMatch) {
    const parts = attorneyNameMatch[1].trim().replace(/,?\s*Esq\.?/i, "").split(/\s+/);
    const represents = attorneyForMatch ? attorneyForMatch[1].trim().toLowerCase() : "";

    contacts.push({
      firstName: parts[0] || "",
      lastName: parts[parts.length - 1] || "",
      firmName: firmNameMatch ? firmNameMatch[1].trim() : "",
      email: allEmails.find((e) => e.includes("service@") || e.includes("legal") || e.includes("law")) || "",
      phone: firmPhoneMatch ? firmPhoneMatch[1].trim() : "",
      type: "attorney",
      role: represents.includes("petition") ? "petitioner_attorney" : represents.includes("respond") ? "respondent_attorney" : "other",
      represents: represents.includes("petition") ? "petitioner" : represents.includes("respond") ? "respondent" : "na",
      barNumber: barNumberMatch ? barNumberMatch[1] : "",
      receivesResults: true, receivesStatus: true, receivesInvoices: false, canOrderTests: false,
    });
  }

  // Look for "counsel" mentions
  const counselMatches = fullText.matchAll(/(?:counsel\s+(?:for\s+)?(?:the\s+)?(\w+))[:\s,]*\n?\s*([A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+)/gi);
  for (const match of counselMatches) {
    const party = match[1].toLowerCase();
    const name = match[2].trim();
    const parts = name.split(/\s+/);
    const alreadyAdded = contacts.some((c) => c.lastName === parts[parts.length - 1]);
    if (!alreadyAdded && parts.length >= 2) {
      contacts.push({
        firstName: parts[0], lastName: parts[parts.length - 1],
        firmName: "", email: "", phone: "",
        type: "attorney",
        role: party.includes("petition") ? "petitioner_attorney" : party.includes("respond") ? "respondent_attorney" : "other",
        represents: party.includes("petition") ? "petitioner" : party.includes("respond") ? "respondent" : "na",
        barNumber: "",
        receivesResults: true, receivesStatus: true, receivesInvoices: false, canOrderTests: false,
      });
    }
  }

  // GAL / Guardian ad Litem / child's representative
  const galPatterns = [
    /Guardian\s+ad\s+Lit[ei]m\s*\n?\s*([A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+)/i,
    /([A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+)\s*[-–—]\s*(?:counsel\s+for\s+)?(?:the\s+)?(?:child|minor)/i,
    /([A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+)\s+child['']?s?\s+representative/i,
    /child['']?s?\s+representative\s*\n?\s*([A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+)/i,
  ];
  for (const pat of galPatterns) {
    const match = fullText.match(pat);
    if (match) {
      const parts = match[1].trim().split(/\s+/);
      if (parts.length >= 2) {
        contacts.push({
          firstName: parts[0], lastName: parts[parts.length - 1],
          firmName: "", email: "", phone: "",
          type: "gal", role: "gal", represents: "child", barNumber: "",
          receivesResults: true, receivesStatus: true, receivesInvoices: false, canOrderTests: true,
        });
        break;
      }
    }
  }

  // Distribution list — look for "results to" section and extract emails
  const resultsSection = fullText.match(/(?:release|send|provide).*?results.*?(?:to|following)[:\s]*([\s\S]*?)(?:\d+\.\s|\n\n)/i);
  if (resultsSection) {
    const sectionEmails = resultsSection[1].match(/[\w.+-]+@[\w.-]+\.\w+/g) || [];
    for (const email of sectionEmails) {
      const alreadyExists = contacts.some((c) => c.email === email) || donors.some((d) => d.email === email);
      if (!alreadyExists) {
        // Try to find a name near this email
        const nameMatch = fullText.match(new RegExp(`([A-Z][a-z]+(?:\\s+[A-Z]\\.?)?\\s+[A-Z][a-z]+).*?${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, "i"));
        contacts.push({
          firstName: nameMatch ? nameMatch[1].split(" ")[0] : "",
          lastName: nameMatch ? nameMatch[1].split(" ").pop() || "" : "",
          firmName: "", email, phone: "",
          type: "other", role: "other", represents: "na", barNumber: "",
          receivesResults: true, receivesStatus: true, receivesInvoices: false, canOrderTests: false,
        });
      }
    }
  }

  // Also check if "Pro Se" respondent/petitioner should be in distribution
  if (upperText.includes("PRO SE")) {
    const proSeParty = upperText.indexOf("RESPONDENT") < upperText.indexOf("PRO SE") + 50 ? "respondent" : "petitioner";
    const donor = donors.find((d) => d.party === proSeParty);
    if (donor && donor.email) {
      const alreadyInContacts = contacts.some((c) => c.email === donor.email);
      if (!alreadyInContacts) {
        contacts.push({
          firstName: donor.firstName, lastName: donor.lastName,
          firmName: "", email: donor.email, phone: donor.phone,
          type: "other", role: "other", represents: proSeParty, barNumber: "",
          receivesResults: true, receivesStatus: true, receivesInvoices: false, canOrderTests: false,
        });
      }
    }
  }

  // Extract test orders
  const testOrders: Array<{
    description: string; specimenType: string; lab: string;
    observed: boolean; scheduling: string; catalogSearch: string; notes: string;
  }> = [];

  // Hair tests
  const hairPanelMatch = fullText.match(/(\d+)[\s-]*panel\s*(?:hair|follicle)/i);
  if (hairPanelMatch || upperText.includes("HAIR FOLLICLE TEST") || upperText.includes("HAIR TEST")) {
    const panelNum = hairPanelMatch ? hairPanelMatch[1] : "5";
    testOrders.push({
      description: `${panelNum} Panel Hair/Nail Test`, specimenType: "hair", lab: "usdtl",
      observed: false, scheduling: "scheduled", catalogSearch: `${panelNum} Panel Hair`, notes: "",
    });
  }

  // Urine tests
  const urinePanelMatch = fullText.match(/(\d+)[\s-]*panel\s*(?:urine|urinalysis|drug\s*(?:test|screen))/i);
  if (urinePanelMatch) {
    testOrders.push({
      description: `${urinePanelMatch[1]} Panel Urine Test`, specimenType: "urine", lab: "usdtl",
      observed: false, scheduling: "scheduled", catalogSearch: `${urinePanelMatch[1]} Panel Urine`, notes: "",
    });
  }

  // Basic "drug and/or alcohol testing" without specific panel
  if (testOrders.length === 0 && fullText.match(/drug\s+and\/or\s+alcohol\s+test/i)) {
    testOrders.push({
      description: "Drug and Alcohol Testing (panel TBD)", specimenType: "urine", lab: "usdtl",
      observed: false, scheduling: "scheduled", catalogSearch: "", notes: "Specific panel not specified in order — confirm with attorney/GAL",
    });
  }

  // PEth
  if (upperText.includes("PETH") || upperText.includes("PHOSPHATIDYLETHANOL")) {
    testOrders.push({
      description: "PEth - Phosphatidylethanol (Blood)", specimenType: "blood", lab: "usdtl",
      observed: false, scheduling: "scheduled", catalogSearch: "PEth", notes: "",
    });
  }

  // EtG
  if (upperText.includes("ETG") && !testOrders.some((t) => t.description.includes("ETG"))) {
    testOrders.push({
      description: "EtG Alcohol Test", specimenType: "hair", lab: "usdtl",
      observed: false, scheduling: "scheduled", catalogSearch: "EtG", notes: "",
    });
  }

  // Sweat patch
  if (upperText.includes("SWEAT PATCH")) {
    testOrders.push({
      description: "Sweat Patch Testing", specimenType: "sweat_patch", lab: "crl",
      observed: false, scheduling: "scheduled", catalogSearch: "Sweat Patch", notes: "",
    });
  }

  // ChildGuard
  if (upperText.includes("CHILDGUARD") || upperText.includes("ENVIRONMENTAL EXPOSURE")) {
    testOrders.push({
      description: "ChildGuard Environmental Exposure", specimenType: "hair", lab: "usdtl",
      observed: false, scheduling: "scheduled", catalogSearch: "ChildGuard", notes: "",
    });
  }

  // Scheduling / frequency
  let frequency = "";
  let scheduling = "scheduled";
  if (upperText.includes("RANDOM")) { frequency = "Random"; scheduling = "random"; }
  const freqMatch = fullText.match(/(\d+)\s*(?:per|times|x)\s*(?:per\s*)?(\w+)/i);
  if (freqMatch) frequency = `${freqMatch[1]}x per ${freqMatch[2]}`;
  testOrders.forEach((t) => { t.scheduling = scheduling; });

  // Who pays
  let whoPays = "";
  if (upperText.includes("EACH PARTY")) whoPays = "Each party";
  else if (upperText.match(/PETITIONER\s+SHALL\s+PAY/)) whoPays = "Petitioner";
  else if (upperText.match(/RESPONDENT\s+SHALL\s+PAY/)) whoPays = "Respondent";
  else if (upperText.includes("SPLIT")) whoPays = "Split";
  else if (upperText.match(/PAID\s+BY\s+EACH/)) whoPays = "Each party";

  // Duration
  let testingDuration = "";
  const durMatch = fullText.match(/(\d+\s*(?:months?|weeks?|days?|years?))/i);
  if (durMatch) testingDuration = durMatch[1];

  // Special instructions
  let specialInstructions = "";
  if (upperText.includes("REFRAIN FROM SHAVING") || upperText.includes("SHALL NOT SHAVE")) specialInstructions += "Donor must not shave/cut hair or nails. ";
  if (upperText.includes("REFRAIN FROM") && upperText.includes("ALCOHOL")) specialInstructions += "No alcohol-containing products. ";
  const betweenDates = fullText.match(/between\s+([\w\s,]+?\d{4})\s+and\s+([\w\s,]+?\d{4})/i);
  if (betweenDates) specialInstructions += `Testing window: ${betweenDates[1].trim()} to ${betweenDates[2].trim()}. `;

  // Observed collection
  const observed = upperText.includes("OBSERVED COLLECTION") || upperText.includes("OBSERVED TEST");
  testOrders.forEach((t) => { t.observed = observed; });

  return {
    courtCaseNumber, county, judgeName, orderDate, whoPays, frequency, testingDuration,
    specialInstructions: specialInstructions.trim(),
    notes: "",
    donors, contacts, testOrders,
  };
}

export async function POST(request: NextRequest) {
  try {
    const buffer = await request.arrayBuffer();
    const data = await pdf(Buffer.from(buffer));
    const extractedText = data.text || "";

    if (!extractedText || extractedText.length < 20) {
      return NextResponse.json({
        text: "Could not extract text from this PDF. It may be a scanned image.",
        parsed: {
          courtCaseNumber: "", county: "Cook County", judgeName: "", orderDate: "",
          whoPays: "", frequency: "", testingDuration: "", specialInstructions: "",
          notes: "PDF text extraction failed — please fill in manually",
          donors: [], contacts: [], testOrders: [],
        },
      });
    }

    const parsed = parseCourtOrderText(extractedText);

    return NextResponse.json({ text: extractedText.substring(0, 5000), parsed });
  } catch (error) {
    console.error("Error extracting PDF:", error);
    return NextResponse.json({ error: "Failed to extract PDF text" }, { status: 500 });
  }
}
