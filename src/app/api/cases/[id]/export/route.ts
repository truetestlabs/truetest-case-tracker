import { NextRequest, NextResponse } from "next/server";
import { generateCaseExportXLSX } from "@/lib/xlsx/case-export";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: caseId } = await params;

  try {
    const xlsxBuffer = await generateCaseExportXLSX(caseId);

    return new NextResponse(new Uint8Array(xlsxBuffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="case-export-${caseId.slice(0, 8)}.xlsx"`,
      },
    });
  } catch (error) {
    console.error("Error exporting case:", error);
    return NextResponse.json({ error: "Failed to export case" }, { status: 500 });
  }
}
