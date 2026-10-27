import { Controller, Get } from "@nestjs/common";

@Controller("health")
export class HealthController {
  @Get()
  health() {
    return {
      status: "ok",
      service: "al-qadr-ota-api",
      mode: "development-scaffold",
      timestamp: new Date().toISOString(),
      supplierIntegrations: "disabled",
    };
  }
}
