import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingState } from "@/components/loading-state";
import { Badge } from "@/components/ui/badge";
import { BarChart3, TrendingUp, Users, Target, AlertTriangle, CheckCircle } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend,
} from "recharts";
import { t } from "@/lib/i18n";

interface Summary {
  totalTests: number;
  totalAttempts: number;
  overallPassRate: number;
  overallAvgPercent: number;
}

interface TestStat {
  testId: string;
  testTitle: string;
  totalAttempts: number;
  passRate: number;
  avgScore: number;
  avgPercent: number;
}

interface TopicStat {
  topicId: string;
  topicName: string;
  totalAppearances: number;
  avgPercent: number;
  passRate: number | null;
  hasPassRule: boolean;
  failureCount: number;
}

interface TrendData {
  date: string;
  attempts: number;
  avgPercent: number;
  passRate: number;
}

interface AnalyticsData {
  summary: Summary;
  testStats: TestStat[];
  topicStats: TopicStat[];
  trends: TrendData[];
}

export default function AnalyticsPage() {
  const { data, isLoading, error } = useQuery<AnalyticsData>({
    queryKey: ["/api/analytics"],
  });

  if (isLoading) {
    return <LoadingState message={t.analytics.loading} />;
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">{t.common.failedToLoadAnalytics}</p>
      </div>
    );
  }

  const { summary, testStats, topicStats, trends } = data;

  const mostFailedTopics = [...topicStats]
    .filter((topic) => topic.hasPassRule && topic.failureCount > 0)
    .sort((a, b) => b.failureCount - a.failureCount)
    .slice(0, 5);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="text-analytics-title">{t.analytics.title}</h1>
        <p className="text-muted-foreground">{t.analytics.description}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card data-testid="card-total-tests">
          <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t.analytics.totalTests}</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-tests">{summary.totalTests}</div>
          </CardContent>
        </Card>

        <Card data-testid="card-total-attempts">
          <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t.analytics.totalAttempts}</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-attempts">{summary.totalAttempts}</div>
          </CardContent>
        </Card>

        <Card data-testid="card-pass-rate">
          <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t.analytics.overallPassRate}</CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-pass-rate">{summary.overallPassRate.toFixed(1)}%</div>
          </CardContent>
        </Card>

        <Card data-testid="card-avg-score">
          <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t.analytics.avgScore}</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-avg-score">{summary.overallAvgPercent.toFixed(1)}%</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card data-testid="card-trends-chart">
          <CardHeader>
            <CardTitle className="text-lg">{t.analytics.attemptTrends} (30 {t.analytics.date.toLowerCase()})</CardTitle>
          </CardHeader>
          <CardContent>
            {trends.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={trends}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis 
                    dataKey="date" 
                    tickFormatter={(val) => new Date(val).toLocaleDateString("ru-RU", { month: "short", day: "numeric" })}
                    className="text-xs"
                  />
                  <YAxis className="text-xs" />
                  <Tooltip 
                    labelFormatter={(val) => new Date(val).toLocaleDateString("ru-RU")}
                    contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                  />
                  <Legend />
                  <Line 
                    type="monotone" 
                    dataKey="attempts" 
                    stroke="hsl(var(--primary))" 
                    strokeWidth={2}
                    name={t.analytics.attempts}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="passRate" 
                    stroke="hsl(var(--chart-2))" 
                    strokeWidth={2}
                    name={t.analytics.passRate}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                {t.analytics.noData}
              </div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-test-performance">
          <CardHeader>
            <CardTitle className="text-lg">{t.analytics.testPerformance}</CardTitle>
          </CardHeader>
          <CardContent>
            {testStats.filter((item) => item.totalAttempts > 0).length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={testStats.filter((item) => item.totalAttempts > 0)}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis 
                    dataKey="testTitle" 
                    className="text-xs"
                    tick={{ fontSize: 10 }}
                    angle={-45}
                    textAnchor="end"
                    height={80}
                  />
                  <YAxis className="text-xs" />
                  <Tooltip 
                    contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                  />
                  <Legend />
                  <Bar dataKey="avgPercent" fill="hsl(var(--primary))" name={`${t.common.avg} %`} />
                  <Bar dataKey="passRate" fill="hsl(var(--chart-2))" name={t.analytics.passRate} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                {t.analytics.noAttempts}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card data-testid="card-topic-stats">
          <CardHeader>
            <CardTitle className="text-lg">{t.analytics.topicStatistics}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {topicStats.length > 0 ? (
                topicStats.map((topic) => (
                  <div 
                    key={topic.topicId} 
                    className="flex items-center justify-between gap-4"
                    data-testid={`row-topic-${topic.topicId}`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{topic.topicName}</p>
                      <p className="text-sm text-muted-foreground">
                        {topic.totalAppearances} {t.common.appearances}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="whitespace-nowrap">
                        {topic.avgPercent.toFixed(1)}% {t.common.avg}
                      </Badge>
                      {topic.hasPassRule && topic.passRate !== null ? (
                        topic.passRate >= 70 ? (
                          <CheckCircle className="h-4 w-4 text-green-500" />
                        ) : topic.passRate >= 50 ? (
                          <AlertTriangle className="h-4 w-4 text-yellow-500" />
                        ) : (
                          <AlertTriangle className="h-4 w-4 text-red-500" />
                        )
                      ) : null}
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-muted-foreground text-center py-8">{t.analytics.noData}</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-failed-topics">
          <CardHeader>
            <CardTitle className="text-lg">{t.analytics.mostFailedTopics}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {mostFailedTopics.length > 0 ? (
                mostFailedTopics.map((topic, idx) => (
                  <div 
                    key={topic.topicId}
                    className="flex items-center justify-between gap-4"
                    data-testid={`row-failed-topic-${idx}`}
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <span className="flex items-center justify-center w-6 h-6 rounded-full bg-destructive/10 text-destructive text-xs font-medium">
                        {idx + 1}
                      </span>
                      <p className="font-medium truncate">{topic.topicName}</p>
                    </div>
                    <Badge variant="destructive">
                      {topic.failureCount} {t.common.failures}
                    </Badge>
                  </div>
                ))
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <CheckCircle className="h-8 w-8 text-green-500 mb-2" />
                  <p className="text-muted-foreground">{t.common.noTopicFailures}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card data-testid="card-test-details">
        <CardHeader>
          <CardTitle className="text-lg">{t.common.testDetails}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-2 font-medium">{t.common.test}</th>
                  <th className="text-right py-3 px-2 font-medium">{t.analytics.attempts}</th>
                  <th className="text-right py-3 px-2 font-medium">{t.common.avg} %</th>
                  <th className="text-right py-3 px-2 font-medium">{t.analytics.passRate}</th>
                </tr>
              </thead>
              <tbody>
                {testStats.map((test) => (
                  <tr key={test.testId} className="border-b" data-testid={`row-test-${test.testId}`}>
                    <td className="py-3 px-2">{test.testTitle}</td>
                    <td className="py-3 px-2 text-right">{test.totalAttempts}</td>
                    <td className="py-3 px-2 text-right">{test.avgPercent.toFixed(1)}%</td>
                    <td className="py-3 px-2 text-right">
                      <Badge variant={test.passRate >= 70 ? "secondary" : test.passRate >= 50 ? "outline" : "destructive"}>
                        {test.passRate.toFixed(1)}%
                      </Badge>
                    </td>
                  </tr>
                ))}
                {testStats.length === 0 && (
                  <tr>
                    <td colSpan={4} className="text-center py-8 text-muted-foreground">
                      {t.common.noTestsAvailable}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
