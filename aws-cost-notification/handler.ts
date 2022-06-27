import axios from "axios";
import dayjs from "dayjs";
import {
  CostExplorerClient,
  GetCostAndUsageCommand,
} from "@aws-sdk/client-cost-explorer";

interface DailyCostReport {
  date: string;
  costs: { service: string; usd: number }[];
}

async function sendSlackMessage(blocks: unknown[]) {
  await axios.post(
    process.env.SLACK_WEBHOOK_URL,
    { blocks },
    {
      headers: {
        "Content-Type": "application/json",
      },
    }
  );
}

async function getDailyCostReports(
  start: string,
  end: string
): Promise<{ reports: DailyCostReport[]; services: string[]; total: number }> {
  const client = new CostExplorerClient({ region: process.env.AWS_REGION });

  const metric = "UnblendedCost";
  const command = new GetCostAndUsageCommand({
    Granularity: "DAILY",
    Metrics: [metric],
    TimePeriod: { Start: start, End: end },
    GroupBy: [
      {
        Type: "DIMENSION",
        Key: "SERVICE",
      },
    ],
  });
  const result = await client.send(command);

  const reports: DailyCostReport[] = [];
  const services: Set<string> = new Set();
  let total: number = 0;
  for (const rbt of result.ResultsByTime) {
    const costs: DailyCostReport["costs"] = [];
    for (const g of rbt.Groups) {
      const service = g.Keys[0];
      const usd = Number(g.Metrics[metric].Amount);
      costs.push({ service, usd });

      total += usd;
      services.add(service);
    }
    reports.push({
      date: rbt.TimePeriod.Start,
      costs,
    });
  }

  return {
    reports,
    services: [...services.values()],
    total,
  };
}

function generateChartUrl(reports: DailyCostReport[], services: string[]) {
  const data = {
    type: "bar",
    data: {
      labels: reports.map((r) => dayjs(r.date).format("M/D")),
      datasets: services.map((s) => ({
        label: s,
        data: reports.map(
          (r) => r.costs.find((c) => c.service === s)?.usd ?? 0
        ),
      })),
    },
    options: {
      legend: {
        labels: {
          fontSize: 8,
        },
      },
    },
  };
  return `https://quickchart.io/chart?c=${encodeURIComponent(
    JSON.stringify(data)
  )}`;
}

export async function run(event, context) {
  const { reports, services, total } = await getDailyCostReports(
    dayjs().subtract(1, "week").format("YYYY-MM-DD"),
    dayjs().format("YYYY-MM-DD")
  );
  const chartUrl = generateChartUrl(reports, services);

  await sendSlackMessage([
    {
      type: "image",
      title: {
        type: "plain_text",
        text: "AWS Costs",
      },
      image_url: chartUrl,
      alt_text: "AWS Costs Chart",
    },
    {
      type: "section",
      text: {
        type: "plain_text",
        text: `:money_with_wings: Weekly cost: $${total.toFixed(2)}`,
        emoji: true,
      },
    },
  ]);
}
