import { CIResult } from "./pr-info";

export function failure(passed: boolean) {
    return passed ? "✅" : "❌";
}

export function pending(passed: boolean) {
    return passed ? "✅" : "⏳";
}

export function result(result: CIResult) {
    switch (result) {
        case "pass":
            return "✅";
        case "unknown":
            return "⏳";
        default:
            return "❌";
    }
}
