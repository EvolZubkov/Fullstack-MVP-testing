import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/loading-state";
import { CheckCircle, XCircle, AlertTriangle, Eye, History, TrendingUp } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { t, formatAttempts } from "@/lib/i18n";

interface AttemptData {
  id: string;
  testVersion: number;
  finishedAt: string;
  overallPercent: number;
  overallPassed: boolean;
  totalEarnedPoints: number;
  totalPossiblePoints: number;
  delta: number | null;
  isOutdated: boolean;
}

interface TestGroup {
  testId: string;
  testTitle: string;
  currentVersion: number;
  attemptCount: number;
  overallImprovement: number | null;
  attempts: AttemptData[];
}

export default function HistoryPage() {
  const { data: testGroups, isLoading } = useQuery<TestGroup[]>({
    queryKey: ["/api/learner/attempts"],
  });

  if (isLoading) {
    return <LoadingState message={t.history.loading} />;
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="text-history-title">{t.history.title}</h1>
        <p className="text-muted-foreground">{t.history.description}</p>
      </div>

      {!testGroups || testGroups.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <History className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground text-center">
              {t.history.noHistory}
            </p>
            <Link href="/learner">
              <Button className="mt-4" data-testid="button-browse-tests">{t.history.browseTests}</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        testGroups.map((group) => (
          <Card key={group.testId} data-testid={`card-test-history-${group.testId}`}>
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <CardTitle className="text-lg">{group.testTitle}</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {formatAttempts(group.attemptCount)} 
                    {" | "}{t.history.currentVersion} v{group.currentVersion}
                  </p>
                </div>
                {group.overallImprovement !== null && group.overallImprovement > 0 && (
                  <Badge variant="secondary" className="gap-1" data-testid={`badge-improvement-${group.testId}`}>
                    <TrendingUp className="h-3 w-3" />
                    +{group.overallImprovement.toFixed(1)}%
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {group.attempts.map((attempt) => (
                  <div 
                    key={attempt.id}
                    className="flex items-center justify-between gap-4 p-3 rounded-md border"
                    data-testid={`row-attempt-${attempt.id}`}
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      {attempt.overallPassed ? (
                        <CheckCircle className="h-5 w-5 text-green-500 shrink-0" />
                      ) : (
                        <XCircle className="h-5 w-5 text-red-500 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">
                            {attempt.overallPercent.toFixed(1)}%
                          </span>
                          <span className="text-sm text-muted-foreground">
                            ({attempt.totalEarnedPoints}/{attempt.totalPossiblePoints} {t.common.points})
                          </span>
                          {attempt.delta !== null && (
                            <Badge 
                              variant={attempt.delta > 0 ? "secondary" : attempt.delta < 0 ? "destructive" : "outline"}
                              className="text-xs"
                              data-testid={`badge-delta-${attempt.id}`}
                            >
                              {attempt.delta >= 0 ? "+" : ""}{attempt.delta.toFixed(1)}%
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap mt-1">
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(attempt.finishedAt), "d MMM yyyy 'в' HH:mm", { locale: ru })}
                          </span>
                          <Badge variant="outline" className="text-xs">
                            v{attempt.testVersion}
                          </Badge>
                          {attempt.isOutdated && (
                            <Badge 
                              variant="outline" 
                              className="text-xs gap-1 text-amber-600 border-amber-600"
                              data-testid={`badge-outdated-${attempt.id}`}
                            >
                              <AlertTriangle className="h-3 w-3" />
                              {t.history.outdated}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                    <Link href={`/learner/result/${attempt.id}`}>
                      <Button variant="ghost" size="sm" data-testid={`button-view-result-${attempt.id}`}>
                        <Eye className="h-4 w-4 mr-1" />
                        {t.history.viewResult}
                      </Button>
                    </Link>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
