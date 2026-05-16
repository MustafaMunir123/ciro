export type AlertCategory = "traffic" | "protest" | "weather" | "infra";

export type AlertSourceName = "twitter" | "reddit" | "facebook" | "googleNews";

export interface AlertSource {
    name: AlertSourceName;
    endpoint: string;
}

export interface SocialPostSentiment {
    polarity?: string;
    dominant_emotion?: string;
}

export interface SocialPost {
    snippet?: string;
    url?: string;
    date?: string;
    sentiment?: SocialPostSentiment;
    [key: string]: unknown;
}

export type AlertSeverity = "low" | "medium" | "high";

export interface ScoredPost extends SocialPost {
    severity: AlertSeverity;
}

export interface ClassifiedAlert extends ScoredPost {
    category: AlertCategory;
    source: AlertSourceName;
}

export interface ProcessedAlert {
    text?: string;
    time?: string;
    source?: string;
    sentiment?: string;
    emotion?: string;
}

export interface QuerySet {
    traffic: string;
    protest: string;
    weather: string;
    infra: string;
}

export interface AlertsResponse {
    count: number;
    alerts: ClassifiedAlert[];
}

export interface RefreshResponse {
    status: "refreshed";
    count: number;
}
