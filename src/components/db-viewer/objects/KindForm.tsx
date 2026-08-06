import { SequenceForm } from "./SequenceForm";
import { EnumForm } from "./EnumForm";
import { ExtensionForm } from "./ExtensionForm";
import { ViewForm } from "./ViewForm";
import { IndexForm } from "./IndexForm";
import { ConstraintForm } from "./ConstraintForm";
import { FunctionForm } from "./FunctionForm";
import { TriggerForm } from "./TriggerForm";
import type { ObjectKind, DdlParams } from "../../../lib/objectCrud";

interface Props {
  connectionId: string;
  kind: ObjectKind;
  params: DdlParams;
  onChange: (p: DdlParams) => void;
}

/** Renders the matching CRUD form for a kind (shared by the context menu and the form tab). */
export function KindForm({ connectionId, kind, params, onChange }: Props) {
  switch (kind) {
    case "sequence":
      return <SequenceForm params={params} onChange={onChange} />;
    case "enum":
      return <EnumForm params={params} onChange={onChange} />;
    case "extension":
      return (
        <ExtensionForm
          connectionId={connectionId}
          params={params}
          onChange={onChange}
        />
      );
    case "view":
      return <ViewForm params={params} onChange={onChange} />;
    case "index":
      return (
        <IndexForm
          connectionId={connectionId}
          params={params}
          onChange={onChange}
        />
      );
    case "constraint":
      return (
        <ConstraintForm
          connectionId={connectionId}
          params={params}
          onChange={onChange}
        />
      );
    case "function":
    case "procedure":
      return <FunctionForm kind={kind} params={params} onChange={onChange} />;
    case "trigger":
      return (
        <TriggerForm
          connectionId={connectionId}
          params={params}
          onChange={onChange}
        />
      );
  }
}