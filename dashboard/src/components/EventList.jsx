import './EventList.css';

export default function EventList({ titulo, items, vazia, renderItem }) {
  return (
    <div className="event-list">
      <h3 className="event-list-titulo">
        {titulo}
        <span className="event-list-count">{items.length}</span>
      </h3>
      <div className="event-list-body">
        {items.length === 0 ? (
          <p className="event-list-vazia">{vazia}</p>
        ) : (
          items.map(renderItem)
        )}
      </div>
    </div>
  );
}
