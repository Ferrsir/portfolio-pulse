import { useEffect, useState } from "react";
import { Search, ExternalLink } from "lucide-react";
import type { MarketStatus, NewsItem } from "../../shared/types";
import { api } from "../backend";
import { Card, Empty, Notice, Badge } from "../ui";
import { ago } from "../format";
export default function News({
  symbols,
  status,
}: {
  symbols: string[];
  status: MarketStatus | null;
}) {
  const [filter, setFilter] = useState("ALL"),
    [items, setItems] = useState<NewsItem[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [search, setSearch] = useState("");
  const key = symbols.join(",");
  useEffect(() => {
    if (filter !== "ALL" && !symbols.includes(filter)) setFilter("ALL");
  }, [key]);
  useEffect(() => {
    if (!symbols.length) {
      setItems([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api<NewsItem[]>(
      "/news?symbols=" +
        encodeURIComponent((filter === "ALL" ? symbols : [filter]).join(",")),
      { signal: controller.signal },
    )
      .then(setItems)
      .catch((e: Error) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [filter, key]);
  const needle = search.trim().toLowerCase(),
    visible = items.filter((n) =>
      (n.title + " " + n.publisher + " " + n.symbols.join(" "))
        .toLowerCase()
        .includes(needle),
    ),
    demo = status?.provider === "demo";
  return (
    <>
      <div className="page-head">
        <div>
          <h1>News</h1>
          <p>Recent headlines for your holdings and watchlist.</p>
        </div>
      </div>
      <div className="toolbar">
        <div className="chips" role="group" aria-label="Filter by symbol">
          {["ALL", ...symbols].map((s) => (
            <button
              key={s}
              className="chip"
              aria-pressed={filter === s}
              onClick={() => setFilter(s)}
            >
              {s === "ALL" ? "All" : s}
            </button>
          ))}
        </div>
        <label className="search">
          <Search size={16} aria-hidden />
          <input
            type="search"
            aria-label="Search headlines"
            placeholder="Search headlines"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>
      {demo && (
        <Notice kind="warn">These headlines are fictional samples for the demo.</Notice>
      )}
      <Card flush>
        {loading ? (
          <Empty title="Loading headlines…" />
        ) : error ? (
          <div className="pad">
            <Notice kind="error">{error}</Notice>
          </div>
        ) : !symbols.length ? (
          <Empty title="No symbols yet">Add holdings or watchlist symbols to see news.</Empty>
        ) : !visible.length ? (
          <Empty title="No headlines found">Try another symbol or search.</Empty>
        ) : (
          <ul className="news-list">
            {visible.map((n) => {
              const linked = n.url && /^https?:\/\//.test(n.url),
                tickers = [...new Set(n.symbols)].filter((s) => symbols.includes(s)).slice(0, 4);
              return (
                <li key={n.id}>
                  <div className="news-meta">
                    <span>{n.publisher}</span>
                    <time dateTime={n.publishedAt} title={new Date(n.publishedAt).toLocaleString()}>
                      {ago(n.publishedAt)}
                    </time>
                    {demo && <Badge kind="warn">Sample</Badge>}
                  </div>
                  {linked ? (
                    <a className="news-title" href={n.url!} target="_blank" rel="noopener noreferrer">
                      {n.title}
                      <ExternalLink size={13} aria-hidden />
                    </a>
                  ) : (
                    <span className="news-title">{n.title}</span>
                  )}
                  {n.description && <p>{n.description}</p>}
                  {tickers.length > 0 && (
                    <div className="news-tickers">
                      {tickers.map((s) => (
                        <Badge key={s}>{s}</Badge>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
