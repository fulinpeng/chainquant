import { Controller, Get, Param, Query } from "@nestjs/common";
import { dashboardQuery, eventQuery, tradeQuery } from "@chainquant/db";

@Controller()
export class QueryController {
  @Get("stats/global")
  async getGlobalStats() {
    return dashboardQuery.getGlobalSummary();
  }

  @Get("stats/:address")
  async getDashboard(@Param("address") address: string) {
    return dashboardQuery.getDashboard(address);
  }

  @Get("trades/:address")
  async getTrades(@Param("address") address: string) {
    const [summary, openPositions, closedTrades, trades] = await Promise.all([
      tradeQuery.getPnLSummary(address),
      tradeQuery.getOpenPositions(address),
      tradeQuery.getClosedTrades(address),
      tradeQuery.listTrades(address),
    ]);

    return {
      summary,
      openPositions,
      closedTrades,
      trades,
    };
  }

  @Get("events/:address")
  async getEvents(
    @Param("address") address: string,
    @Query("limit") limit?: string,
  ) {
    const n = Number(limit);
    const take = Number.isFinite(n) ? n : 50;
    const [events, executionEvents] = await Promise.all([
      eventQuery.listEvents(address, take),
      eventQuery.listExecutionEvents(address),
    ]);

    return {
      events,
      executionEvents,
    };
  }
}
