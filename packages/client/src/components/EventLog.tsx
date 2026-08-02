import type { EventMessage } from "../net/protocol";

export function EventLog({ events }: { events: EventMessage[] }) {
  const recent = [...events].slice(-30).reverse();
  return (
    <div className="event-log">
      <h3>Log</h3>
      <ul>
        {recent.map((e, i) => (
          <li key={`${e.at}-${i}`}>{e.text}</li>
        ))}
      </ul>
    </div>
  );
}
