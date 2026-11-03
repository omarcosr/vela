/** Serviços: one card per service. */
import { Button, Column, Row, Scroll, View } from "@tarve/core";
import { ALL_SERVICES, PHP_WORKERS } from "../../core/services";
import { anyBusy, anyRunning, findStatus, SERVICE_META, ui } from "../store";
import { connectionOf, onInstall, onRestart, onStartAll, onStopAll, onToggleRun, openLogs, openServiceSettings, refresh } from "../actions";
import { GearButton, ServiceCard } from "../components";
import { PageHeader } from "../chrome";

export function ServicesPage() {
  const busyAll = anyBusy();
  return (
    <Column flex={1}>
      <PageHeader
        title="Services"
        subtitle={`Nginx · PHP · MariaDB · Redis  —  ${ui.cfg.root}`}
        actions={
          <Row gap={8} align="center">
            <GearButton icon="refresh" onClick={() => void refresh()} />
            <Button variant="outline" disabled={busyAll || !anyRunning()} onClick={() => void onStopAll()}>
              {ui.globalBusy === "stop" ? "Stopping…" : "Stop all"}
            </Button>
            <Button disabled={busyAll} onClick={() => void onStartAll()}>
              {ui.globalBusy === "start" ? "Starting…" : "Start all"}
            </Button>
          </Row>
        }
      />
      <Scroll flex={1}>
        <View
          padding={{ top: 4, left: 24, right: 24, bottom: 24 }}
          style={{ display: "grid", columns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 14 }}
        >
          {ALL_SERVICES.map((name) => (
            <ServiceCard
              key={name}
              name={name}
              title={SERVICE_META[name].title}
              description={SERVICE_META[name].description}
              state={findStatus(name)}
              svc={ui.cfg.services[name]}
              installed={ui.installed[name]}
              busy={!!ui.busy[name] || ui.globalBusy !== null}
              progress={ui.progress[name]}
              extra={name === "php" ? `${ui.cfg.services.php.port}–${ui.cfg.services.php.port + PHP_WORKERS - 1}` : undefined}
              onToggleRun={() => void onToggleRun(name)}
              onRestart={() => void onRestart(name)}
              onInstall={() => void onInstall(name)}
              onOpenLog={() => openLogs(name)}
              connection={connectionOf(name)}
              onChangePort={() => openServiceSettings(name)}
              onSettings={() => openServiceSettings(name)}
            />
          ))}
        </View>
      </Scroll>
    </Column>
  );
}
