import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BackupProgress } from "./BackupProgress";

describe("BackupProgress", () => {
    it("offers Cancel while a job is running", () => {
        const onCancel = vi.fn();
        render(
            <BackupProgress
                progress={40}
                jobType="dump"
                status="running"
                onCancel={onCancel}
            />,
        );
        fireEvent.click(screen.getByText("Cancel"));
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("shows the failure and a retry action when the job failed", () => {
        const onRetry = vi.fn();
        render(
            <BackupProgress
                progress={50}
                jobType="restore"
                status="failed"
                errorMessage="pg_restore: connection refused"
                onRetry={onRetry}
            />,
        );
        expect(screen.getByText("Failed")).toBeTruthy();
        expect(screen.getByText(/connection refused/)).toBeTruthy();
        fireEvent.click(screen.getByTestId("backup-retry"));
        expect(onRetry).toHaveBeenCalledTimes(1);
        // A finished job cannot be cancelled again.
        expect(screen.queryByText("Cancel")).toBeNull();
    });

    it("reports a cancelled job as cancelled, not failed", () => {
        render(
            <BackupProgress
                progress={50}
                jobType="sync"
                status="cancelled"
                onRetry={() => {}}
            />,
        );
        expect(screen.getByText("Cancelled")).toBeTruthy();
        expect(screen.queryByText("Failed")).toBeNull();
        expect(screen.getByText(/Stopped before it finished/)).toBeTruthy();
        expect(screen.getByTestId("backup-retry")).toBeTruthy();
    });
});
