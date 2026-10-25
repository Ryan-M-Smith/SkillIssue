"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./page.module.css";

type Entry = {
    playerId: string;
    displayName: string;
    wins: number;
    losses: number;
    score: number;
    updatedAt: string;
};

type LeaderboardResponse = {
    entries: Entry[];
    source: string;
    message?: string;
};

export function Leaderboard() {
    const [data, setData] = useState<LeaderboardResponse>({ entries: [], source: "loading" });
    const [lastUpdated, setLastUpdated] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const response = await fetch("/api/leaderboard", { cache: "no-store" });
            const next = await response.json() as LeaderboardResponse;
            setData(next);
            setLastUpdated(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
        } catch {
            setData({ entries: [], source: "error", message: "Unable to reach the leaderboard." });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        const initialLoad = window.setTimeout(() => { void load(); }, 0);
        return () => window.clearTimeout(initialLoad);
    }, [load]);

    return (
        <section className={styles.leaderboard} id="leaderboard">
            <div className={styles.leaderboardHeader}>
                <div>
                    <p className={styles.eyebrow}>Live standings / Tiger Cloud</p>
                    <h2 className={styles.subtitle}>The board is watching.</h2>
                </div>
                <button className={styles.resetButton} type="button" onClick={() => void load()} disabled={loading}>
                    {loading ? "LOADING..." : "RESET / LOAD"}
                </button>
            </div>
            <div className={styles.table}>
                <div className={styles.tableRow + " " + styles.tableHead}>
                    <span>#</span><span>PLAYER</span><span>W / L</span><span>SCORE</span>
                </div>
                {data.entries.length > 0 ? data.entries.map((entry, index) => (
                    <div className={styles.tableRow} key={entry.playerId}>
                        <span className={styles.rank}>{String(index + 1).padStart(2, "0")}</span>
                        <strong>{entry.displayName}</strong>
                        <span>{entry.wins} / {entry.losses}</span>
                        <strong className={styles.score}>{entry.score}</strong>
                    </div>
                )) : (
                    <div className={styles.emptyBoard}>{data.message ?? "Waiting for the first match."}</div>
                )}
            </div>
            <div className={styles.leaderboardFooter}>
                <span>{data.source === "tiger-data" ? "SOURCE: TIGER DATA" : "SOURCE: NOT CONNECTED"}</span>
                <span>{lastUpdated ? `UPDATED ${lastUpdated}` : "SYNCING..."}</span>
            </div>
        </section>
    );
}
