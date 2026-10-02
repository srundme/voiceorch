import { Route, Switch } from "wouter";
import { SalesProtected } from "@/components/sales/sales-protected";
import { SalesLayout } from "@/components/sales/sales-layout";
import { EmptyBlock } from "@/components/sales/sales-ui";
import SalesLogin from "@/pages/sales/login";
import SalesInvite from "@/pages/sales/invite";
import TodayPage from "@/pages/sales/today";
import PipelinePage from "@/pages/sales/pipeline";
import CompanyDetailPage from "@/pages/sales/company-detail";
import PilotsPage from "@/pages/sales/pilots";
import PilotDetailPage from "@/pages/sales/pilot-detail";
import PilotReportPage from "@/pages/sales/pilot-report";
import CalendarPage from "@/pages/sales/calendar";
import CustomersPage from "@/pages/sales/customers";
import ReportsPage from "@/pages/sales/reports";
import SettingsPage from "@/pages/sales/settings";

/** Sales pipeline app — mounted at /sales/* outside the admin-token gate; auth is the ss_sales cookie. */
export default function SalesApp() {
  return (
    <Switch>
      <Route path="/sales/login" component={SalesLogin} />
      <Route path="/sales/invite/:token" component={SalesInvite} />
      <Route path="/sales/pilots/:id/report">
        {(params) => (
          <SalesProtected>
            <PilotReportPage key={params.id} id={Number(params.id)} />
          </SalesProtected>
        )}
      </Route>
      <Route>
        <SalesProtected>
          <SalesLayout>
            <Switch>
              <Route path="/sales" component={TodayPage} />
              <Route path="/sales/pipeline" component={PipelinePage} />
              <Route path="/sales/companies/:id">{(p) => <CompanyDetailPage key={p.id} id={Number(p.id)} />}</Route>
              <Route path="/sales/pilots" component={PilotsPage} />
              <Route path="/sales/pilots/:id">{(p) => <PilotDetailPage key={p.id} id={Number(p.id)} />}</Route>
              <Route path="/sales/calendar" component={CalendarPage} />
              <Route path="/sales/customers" component={CustomersPage} />
              <Route path="/sales/reports" component={ReportsPage} />
              <Route path="/sales/settings" component={SettingsPage} />
              <Route>
                <EmptyBlock title="Page not found" description="This sales page does not exist." />
              </Route>
            </Switch>
          </SalesLayout>
        </SalesProtected>
      </Route>
    </Switch>
  );
}
