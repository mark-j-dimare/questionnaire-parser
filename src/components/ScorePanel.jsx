// SCARED subscale audit: total + the five subscales, each with a cutoff flag.
// (The headline total + interpretation live in the results header in App.)

const Badge = ({ elevated }) => (
  <span
    className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${
      elevated
        ? "bg-amber-100 text-amber-900 ring-amber-200"
        : "bg-green-100 text-green-800 ring-green-200"
    }`}
  >
    <span
      className={`h-1.5 w-1.5 rounded-full ${elevated ? "bg-amber-600" : "bg-green-600"}`}
      aria-hidden="true"
    />
    {elevated ? "Elevated" : "Below"}
  </span>
);

const ScorePanel = ({ score }) => {
  return (
    <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        Score breakdown
      </h2>

      <div className="mb-4 rounded-lg bg-slate-100 p-3">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-medium text-slate-600">Total</span>
          <span className="text-2xl font-bold tabular-nums text-slate-900">
            {score.total}
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="text-xs text-slate-500">
            Cutoff ≥ <span className="tabular-nums">{score.totalCutoff}</span>
          </span>
          <Badge elevated={score.totalElevated} />
        </div>
      </div>

      <ul className="divide-y divide-slate-100">
        {score.subscales.map((s) => (
          <li
            key={s.key}
            className="flex items-center justify-between gap-2 py-2.5 text-sm"
          >
            <span className="font-medium text-slate-700">{s.label}</span>
            <span className="flex items-center gap-2 whitespace-nowrap">
              <span className="font-semibold tabular-nums text-slate-900">
                {s.score}
                <span className="font-normal text-slate-400"> / {s.cutoff}</span>
              </span>
              <Badge elevated={s.elevated} />
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-4 border-t border-slate-200 pt-4 text-xs text-slate-600">
        <span className="font-semibold tabular-nums text-slate-700">
          {score.answered}
        </span>{" "}
        of <span className="tabular-nums">{score.totalQuestions}</span> items scored
        {score.unanswered > 0 && (
          <span className="font-semibold text-amber-800">
            {" "}
            · {score.unanswered} unanswered
          </span>
        )}
      </p>

      <p className="mt-3 text-xs leading-relaxed text-slate-500">
        Screening aid only. Verify every highlighted answer against the form before using
        the score clinically.
      </p>
    </div>
  );
};

export default ScorePanel;
