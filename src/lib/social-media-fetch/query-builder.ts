import locations from "@/app/api/socialMediaFetchQueryData/locations.json";
import trafficQuery from "@/app/api/socialMediaFetchQueryData/trafficQuery.json";
import protestQuery from "@/app/api/socialMediaFetchQueryData/protestQuery.json";
import weatherQuery from "@/app/api/socialMediaFetchQueryData/weatherQuery.json";
import infrastructureQuery from "@/app/api/socialMediaFetchQueryData/infrastrutureQuery.json";
import type { QuerySet } from "./types";

interface LocationGroups {
    core: string[];
    central: string[];
    south: string[];
    east: string[];
}

function buildOr(arr: string[], limit = 6): string {
    return arr.slice(0, limit).map((x) => `"${x}"`).join(" OR ");
}

function getShortLocations(locationGroups: LocationGroups): string[] {
    return [
        ...locationGroups.core,
        ...locationGroups.central.slice(0, 2),
        ...locationGroups.south.slice(0, 2),
        ...locationGroups.east.slice(0, 2),
    ];
}

export function buildQuery(): QuerySet {
    const karachiLocations = (locations as { karachi: LocationGroups }).karachi;
    const locationTerms = buildOr(getShortLocations(karachiLocations), 10);

    const trafficTerms = buildOr(trafficQuery.traffic, 5);
    const protestTerms = buildOr(protestQuery.protest, 5);
    const weatherTerms = buildOr(weatherQuery.weather, 4);
    const infraTerms = buildOr(infrastructureQuery.infrastructure, 4);

    return {
        traffic: `(${locationTerms}) AND (${trafficTerms})`,
        protest: `(${locationTerms}) AND (${protestTerms})`,
        weather: `(${locationTerms}) AND (${weatherTerms})`,
        infra: `(${locationTerms}) AND (${infraTerms})`,
    };
}
