import type { AlertSource } from "./types";

export const ALERT_SOURCES: AlertSource[] = [
    { name: "twitter", endpoint: "/v1/twitter/posts" },
    { name: "reddit", endpoint: "/v1/reddit/posts" },
    { name: "facebook", endpoint: "/v1/facebook/posts" },
    { name: "googleNews", endpoint: "/v1/news/articles" },
];

export const ALERT_SOURCE_NAMES = ALERT_SOURCES.map((s) => s.name);

export function isAlertSourceName(value: string): value is AlertSource["name"] {
    return (ALERT_SOURCE_NAMES as string[]).includes(value);
}
