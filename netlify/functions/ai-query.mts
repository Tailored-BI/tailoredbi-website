import type { Context, Config } from "@netlify/functions";
import { Connection, Request as TdsRequest, TYPES } from "tedious";

const FABRIC_HOST = "ps46d6p7gwou5nlxnjxw3r4i2a-vicdsupe53wetowpzk2jtzqoy4.datawarehouse.fabric.microsoft.com";
const FABRIC_DB = "Heartland_Warehouse";

const SCHEMA_CONTEXT = `
You are a business intelligence assistant for Heartland Ag Parts Co., a make-to-stock agricultural parts manufacturer in Lohrville, Iowa. You have read-only access to their Microsoft Fabric data warehouse.

WAREHOUSE SCHEMA:

dim.Customer (4,950 rows)
  CustomerKey int, CustomerName varchar, City varchar, State varchar, CreditLimit decimal, SalesRepCode varchar, CustGroup varchar, Terms varchar

dim.Part (7,592 rows)
  PartKey varchar, PartDescription varchar, TypeCode varchar, ProdCode varchar, ClassID varchar, IUM varchar, UnitPrice decimal, NetWeight decimal

dim.Vendor (960 rows)
  VendorKey int, VendorName varchar, City varchar, State varchar, TermsCode varchar

dim.Employee (7,830 rows)
  EmployeeKey varchar, FirstName varchar, LastName varchar, FullName varchar, Department varchar, HireDate date, EmpStatus varchar

dim.Department (13,340 rows)
  DeptKey varchar, DeptDesc varchar, IsProductionDept bit

dim.Account (46,023 rows)
  AccountKey varchar, AccountDesc varchar, AccountType varchar, IsActive bit

dim.Date (4,022 rows)
  DateKey int, Date date, Year int, Month int, MonthName varchar, MonthYear varchar, YearMonth varchar,
  FiscalYear int, FiscalPeriod int, IsToday bit, IsCurrentMonth bit, IsCurrentYear bit,
  DaysFromToday int, RelativeMonth int, RelativeYear int

fact.ARInvoice (20,300 rows)
  ARKey int, CustomerKey int, InvoiceDateKey int, DueDateKey int, InvoiceDate date, DueDate date,
  InvoiceAmt decimal, BalanceDue decimal, AgingBucket varchar
  AgingBucket values: 'Current', '1-30', '31-60', '61-90', '90+'
  Join to dim.Customer on CustomerKey, dim.Date on InvoiceDateKey or DueDateKey

fact.APInvoice (6,090 rows)
  APKey int, VendorKey int, InvoiceDateKey int, DueDateKey int, InvoiceDate date, DueDate date,
  InvoiceAmt decimal, BalanceDue decimal, AgingBucket varchar
  Join to dim.Vendor on VendorKey

fact.GL (73,710 rows)
  GLKey int, FiscalYear int, FiscalPeriod int, JournalCode varchar, GLAccount varchar,
  TranDate date, DebitAmt decimal, CreditAmt decimal, NetAmt decimal
  Join to dim.Account on GLAccount = AccountKey
  Join to dim.Date on CAST(TranDate AS date) = Date (no DateKey on GL)

fact.SalesOrder (42,665 rows)
  SOKey int, CustomerKey int, PartKey varchar, OrderDateKey int, ShipDateKey int,
  OrderDate date, ShipDate date, OrderQty decimal, ShippedQty decimal, BacklogQty decimal, ExtPrice decimal
  Join to dim.Customer on CustomerKey, dim.Part on PartKey, dim.Date on OrderDateKey or ShipDateKey

fact.PurchaseOrder (4,900 rows)
  POKey int, VendorKey int, PartKey varchar, OrderDateKey int, DueDateKey int,
  OrderDate date, DueDate date, OrderQty decimal, ReceivedQty decimal, ExtCost decimal
  Join to dim.Vendor on VendorKey, dim.Part on PartKey

fact.Inventory (14,000 rows)
  InvKey int, TranDateKey int, TranDate date, TranType varchar, PartKey varchar,
  Qty decimal, UnitCost decimal, ExtCost decimal, JobNum varchar
  Join to dim.Part on PartKey

fact.LaborTime (1,481 rows)
  LaborKey int, PayrollDateKey int, PayrollDate date, EmployeeKey varchar,
  JobNum varchar, LaborHrs decimal, BurdenHrs decimal, LaborAmt decimal, TotalAmt decimal
  Join to dim.Employee on EmployeeKey

fact.Production (6,104 rows)
  ProductionKey int, PartKey varchar, CreateDateKey int, DueDateKey int,
  CreateDate date, DueDate date, EstLaborCost decimal, ActLaborCost decimal,
  EstMaterialCost decimal, ActMaterialCost decimal, CostVariance decimal,
  JobReleased bit, JobComplete bit, JobClosed bit
  Join to dim.Part on PartKey

fact.Shipment (6,090 rows)
  ShipKey int, CustomerKey int, PartKey varchar, ShipDateKey int, ShipDate date,
  ShipQty decimal, Weight decimal, ReadyToInvoice bit
  Join to dim.Customer on CustomerKey, dim.Part on PartKey

RULES:
- Only write SELECT statements. Never INSERT, UPDATE, DELETE, DROP, or DDL.
- Always use schema prefixes: dim.Customer, fact.ARInvoice etc.
- For current year: WHERE d.IsCurrentYear = 1 joining to dim.Date
- For current month: WHERE d.IsCurrentMonth = 1
- For YTD: WHERE d.Year = YEAR(GETDATE()) AND d.Date <= CAST(GETDATE() AS date)
- BalanceDue > 0 means invoice is still open/unpaid
- Always TOP 100 unless user asks for aggregate/total
- Format currency with ROUND(col, 2)
- Keep queries simple — no CTEs unless necessary
`;

async function getFabricToken(tenantId: string, clientId: string, clientSecret: string): Promise<string> {
  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://analysis.windows.net/powerbi/api/.default"
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token fetch failed: ${err}`);
  }

  const data = await res.json();
  return data.access_token;
}

function executeFabricSQLWithSPN(query: string, tenantId: string, clientId: string, clientSecret: string): Promise<{ columns: string[]; rows: Record<string, unknown>[] }> {
  return new Promise((resolve, reject) => {
    const config = {
      server: FABRIC_HOST,
      authentication: {
        type: "azure-active-directory-service-principal-secret" as const,
        options: {
          clientId,
          clientSecret,
          tenantId
        }
      },
      options: {
        database: FABRIC_DB,
        encrypt: true,
        port: 1433,
        connectTimeout: 30000,
        requestTimeout: 30000
      }
    };

    const connection = new Connection(config);
    connection.on("connect", (err) => {
      if (err) { reject(err); return; }

      const columns: string[] = [];
      const rows: Record<string, unknown>[] = [];

      const request = new TdsRequest(query, (err) => {
        connection.close();
        if (err) { reject(err); return; }
        resolve({ columns, rows });
      });

      request.on("columnMetadata", (cols) => {
        for (const col of cols) columns.push(col.colName);
      });

      request.on("row", (rowCols) => {
        const row: Record<string, unknown> = {};
        for (const col of rowCols) row[col.metadata.colName] = col.value;
        rows.push(row);
      });

      connection.execSql(request);
    });

    connection.connect();
  });
}

function executeFabricSQL(query: string, token: string): Promise<{ columns: string[]; rows: Record<string, unknown>[] }> {
  return new Promise((resolve, reject) => {
    const config = {
      server: FABRIC_HOST,
      authentication: {
        type: "azure-active-directory-access-token" as const,
        options: { token }
      },
      options: {
        database: FABRIC_DB,
        encrypt: true,
        port: 1433,
        connectTimeout: 30000,
        requestTimeout: 30000,
        rowCollectionOnRequestCompletion: true
      }
    };

    const connection = new Connection(config);
    connection.on("connect", (err) => {
      if (err) { reject(err); return; }

      const columns: string[] = [];
      const rows: Record<string, unknown>[] = [];

      const request = new TdsRequest(query, (err, rowCount, resultRows) => {
        connection.close();
        if (err) { reject(err); return; }
        resolve({ columns, rows });
      });

      request.on("columnMetadata", (cols) => {
        for (const col of cols) columns.push(col.colName);
      });

      request.on("row", (rowCols) => {
        const row: Record<string, unknown> = {};
        for (const col of rowCols) row[col.metadata.colName] = col.value;
        rows.push(row);
      });

      connection.execSql(request);
    });

    connection.connect();
  });
}

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let question: string;
  try {
    const body = await req.json();
    question = body.question?.trim();
    if (!question) throw new Error("No question");
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request — include { question: string }" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  const anthropicKey = Netlify.env.get("ANTHROPIC_API_KEY");
  const clientId = Netlify.env.get("FABRIC_CLIENT_ID");
  const clientSecret = Netlify.env.get("FABRIC_CLIENT_SECRET");
  const tenantId = Netlify.env.get("FABRIC_TENANT_ID");

  if (!anthropicKey || !clientId || !clientSecret || !tenantId) {
    return new Response(JSON.stringify({ error: "Service not fully configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        system: SCHEMA_CONTEXT + `

Your job is to answer questions about Heartland's business data.

When you receive a question:
1. Write a SQL query to answer it
2. Return ONLY a JSON object with this exact structure — no markdown, no extra text:
{
  "sql": "SELECT ...",
  "explanation": "One sentence describing what this query returns",
  "chartType": "table" or "number" or "bar"
}

chartType rules:
- "number" — single aggregate value (totals, counts, averages)
- "bar" — comparison across categories (by customer, by part, by month)
- "table" — detailed row-level results (lists of invoices, customers, parts)`,
        messages: [{ role: "user", content: question }]
      })
    });

    if (!claudeRes.ok) {
      const errBody = await claudeRes.text();
      return new Response(JSON.stringify({
        error: "Claude API error",
        status: claudeRes.status,
        detail: errBody.substring(0, 500)
      }), { status: 502, headers: { "Content-Type": "application/json" } });
    }

    const claudeData = await claudeRes.json();
    const rawText = claudeData.content?.[0]?.text || "";

    let parsed: { sql: string; explanation: string; chartType: string };
    try {
      const start = rawText.indexOf("{");
      const end = rawText.lastIndexOf("}");
      if (start === -1 || end === -1) throw new Error("No JSON object found");
      parsed = JSON.parse(rawText.substring(start, end + 1));
    } catch {
      return new Response(JSON.stringify({
        error: "Could not parse AI response",
        explanation: "Please try rephrasing your question.",
        rawText: rawText.substring(0, 500)
      }), { status: 500, headers: { "Content-Type": "application/json" } });
    }

    if (!parsed.sql?.trim().toUpperCase().startsWith("SELECT")) {
      return new Response(JSON.stringify({
        error: "Only SELECT queries are permitted",
        explanation: parsed.explanation
      }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    let fabricResult: { columns: string[]; rows: Record<string, unknown>[] };

    // Try access-token auth first, fall back to direct SPN auth
    try {
      const token = await getFabricToken(tenantId, clientId, clientSecret);
      fabricResult = await executeFabricSQL(parsed.sql, token);
    } catch (tokenErr) {
      try {
        fabricResult = await executeFabricSQLWithSPN(parsed.sql, tenantId, clientId, clientSecret);
      } catch (spnErr) {
        throw new Error(`Token auth: ${String(tokenErr).substring(0, 200)} | SPN auth: ${String(spnErr).substring(0, 200)}`);
      }
    }
    const { columns, rows } = fabricResult;

    return new Response(JSON.stringify({
      question,
      sql: parsed.sql,
      explanation: parsed.explanation,
      chartType: parsed.chartType,
      columns,
      rows,
      rowCount: rows.length
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store"
      }
    });

  } catch (err) {
    const msg = String(err);
    return new Response(JSON.stringify({
      error: "Query failed",
      detail: msg.substring(0, 500),
      explanation: msg.includes("Token") ? "Authentication issue — please try again." : "The query could not be completed. Try rephrasing your question."
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
};

export const config: Config = {
  path: "/api/ai-query"
};
