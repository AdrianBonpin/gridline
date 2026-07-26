import { SelectDropdown } from "../ui/SelectDropdown";
import type { Folder } from "../../lib/types";
import { getFolderPathLabel } from "../../lib/utils";

interface FolderSelectProps {
    folders: Folder[];
    value: string | null;
    onChange: (value: string | null) => void;
}

export function FolderSelect({ folders, value, onChange }: FolderSelectProps) {
    const options = [
        { value: "", label: "None" },
        ...folders.map((folder) => ({
            value: folder.id,
            label: getFolderPathLabel(folders, folder.id),
        })),
    ];

    return (
        <SelectDropdown
            value={value ?? ""}
            onChange={(next) => onChange(next === "" ? null : next)}
            options={options}
            placeholder="None"
        />
    );
}