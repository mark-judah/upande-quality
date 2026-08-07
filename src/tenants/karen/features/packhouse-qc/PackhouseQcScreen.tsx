import { useEffect, useState } from 'react';
import { FlatList, Modal, Pressable, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { Screen } from '@/src/core/ui/Screen';
import { Card, Alert } from '@/src/core/ui/Card';
import { Button } from '@/src/core/ui/Button';
import { DecisionChip } from '@/src/core/ui/DecisionChip';
import { LabeledInput } from '@/src/core/ui/LabeledInput';
import { ScanField } from '@/src/core/scanning/ScanField';
import { useToast } from '@/src/core/ui/Toast';
import { COLORS, borderRadius, fontFamily, fontSize, spacing } from '@/src/core/theme';
import { useAuthStore } from '@/src/core/auth/store';
import {
  useKarenPackhouseQcStore,
  computeOverallResult,
  issueCountLabel,
  packRatePerBox,
  suggestedBoxSampleSize,
  sampledBunches,
  affectedPercent,
  isThresholdBreached,
  stemsPerBunch,
  totalBunches,
  type IssueRow,
  type OnlineMode,
  type QcType,
  type SpecCheckState,
} from '@/src/tenants/karen/state/karen-packhouse-qc-store';
import type { PackhouseOverallResult } from '@/src/tenants/karen/repository/karen-packhouse-qc-repository';
import { categoryForParam, categoryOrder } from '@/src/tenants/karen/features/packhouse-qc/qc-parameter-categories';

/** Grading / Reject teams — mirrors the Order Pick List `custom_team` options.
 *  The team filter uses these to reach orders that have no specification linked
 *  (which the customer→spec path can never list). */
const TEAMS = ['Team A', 'Team B', 'Jamafa', 'Eldama', 'Bravo'];

/** Which Frappe Role unlocks which workflow, plus the copy for its landing
 *  tile — the operator never has to pick between things they're not
 *  actually assigned to do. */
const WORKFLOW_OPTIONS: {
  key: string;
  label: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  role: string;
  qcType: QcType;
  onlineMode: OnlineMode | null;
}[] = [
  {
    key: 'reject-recorder',
    label: 'Reject Recorder',
    description: 'Check stems against the order list and record rejects.',
    icon: 'flag-outline',
    role: 'REJECT ANALYST',
    qcType: 'Online QC',
    onlineMode: 'Reject Recorder',
  },
  {
    key: 'grading-qc',
    label: 'Grading QC',
    description: 'Check bunches — accept them or send them for replacement.',
    icon: 'leaf-outline',
    role: 'GRADING QC',
    qcType: 'Online QC',
    onlineMode: 'Grading QC',
  },
  {
    key: 'final-qc',
    label: 'Final QC',
    description: 'Scan a box, sample it against the spec, and decide the order.',
    icon: 'cube-outline',
    role: 'FINISHED QC',
    qcType: 'Final QC',
    onlineMode: null,
  },
  {
    key: 'airport-returns',
    label: 'Airport Returns',
    description: 'Scan a returned box, then reuse or reject the returned stems.',
    icon: 'airplane-outline',
    role: 'FINISHED QC',
    qcType: 'Airport Returns',
    onlineMode: null,
  },
];

export function PackhouseQcScreen() {
  const { showSuccess, showError } = useToast();
  const loggedInEmail = useAuthStore((s) => s.email);
  const loggedInFullName = useAuthStore((s) => s.fullName);
  const hasRole = useAuthStore((s) => s.hasRole);

  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [specPickerOpen, setSpecPickerOpen] = useState(false);
  const [teamPickerOpen, setTeamPickerOpen] = useState(false);
  const [orderPickerOpen, setOrderPickerOpen] = useState(false);
  const [airportReasonPickerOpen, setAirportReasonPickerOpen] = useState(false);
  const [paramPickerOpen, setParamPickerOpen] = useState(false);
  const [reasonPickerOpen, setReasonPickerOpen] = useState(false);
  const [boxScanValue, setBoxScanValue] = useState('');
  // Whether the parameter picker is currently being opened for bunch
  // rejection (Grading QC) — null means it's the plain "Add Issue" flow
  // (Reject Recorder, Final QC).
  const [pendingSampleUnit, setPendingSampleUnit] = useState<'bunch' | null>(null);

  const qcType = useKarenPackhouseQcStore((s) => s.qcType);
  const onlineMode = useKarenPackhouseQcStore((s) => s.onlineMode);
  const orderPickLists = useKarenPackhouseQcStore((s) => s.orderPickLists);
  const params = useKarenPackhouseQcStore((s) => s.params);
  const reasons = useKarenPackhouseQcStore((s) => s.reasons);
  const loadingInitial = useKarenPackhouseQcStore((s) => s.loadingInitial);
  const selectedCustomer = useKarenPackhouseQcStore((s) => s.selectedCustomer);
  const selectedSpecificationFilter = useKarenPackhouseQcStore((s) => s.selectedSpecificationFilter);
  const orderPickListsLoading = useKarenPackhouseQcStore((s) => s.orderPickListsLoading);
  const selectedOrderPickList = useKarenPackhouseQcStore((s) => s.selectedOrderPickList);
  const itemLocations = useKarenPackhouseQcStore((s) => s.itemLocations);
  const boxes = useKarenPackhouseQcStore((s) => s.boxes);
  const boxTotalCount = useKarenPackhouseQcStore((s) => s.boxTotalCount);
  const currentSpecification = useKarenPackhouseQcStore((s) => s.currentSpecification);
  const specChecks = useKarenPackhouseQcStore((s) => s.specChecks);
  const acceptSpecCheck = useKarenPackhouseQcStore((s) => s.acceptSpecCheck);
  const setSpecCheckActualValue = useKarenPackhouseQcStore((s) => s.setSpecCheckActualValue);
  const setSpecCheckBunchesAffected = useKarenPackhouseQcStore((s) => s.setSpecCheckBunchesAffected);
  const specificationDetail = useKarenPackhouseQcStore((s) => s.specificationDetail);
  const customerOptionsFn = useKarenPackhouseQcStore((s) => s.customerOptions);
  const specificationsForSelectedCustomer = useKarenPackhouseQcStore((s) => s.specificationsForSelectedCustomer);
  const specOrderCounts = useKarenPackhouseQcStore((s) => s.specOrderCounts);
  const bunchSampling = useKarenPackhouseQcStore((s) => s.bunchSampling);
  const boxesChecked = useKarenPackhouseQcStore((s) => s.boxesChecked);
  const finalDecisionOverride = useKarenPackhouseQcStore((s) => s.finalDecisionOverride);
  const effectiveDecision = useKarenPackhouseQcStore((s) => s.effectiveFinalDecision());
  const orderDetailLoading = useKarenPackhouseQcStore((s) => s.orderDetailLoading);
  const pendingQuarantineStems = useKarenPackhouseQcStore((s) => s.pendingQuarantineStems);
  const selectedVariety = useKarenPackhouseQcStore((s) => s.selectedVariety);
  const scannedBoxName = useKarenPackhouseQcStore((s) => s.scannedBoxName);
  const scannedBoxDetail = useKarenPackhouseQcStore((s) => s.scannedBoxDetail);
  const issues = useKarenPackhouseQcStore((s) => s.issues);
  const totalChecked = useKarenPackhouseQcStore((s) => s.totalChecked);
  const selectedQcIncharge = useKarenPackhouseQcStore((s) => s.selectedQcIncharge);
  const selectedReason = useKarenPackhouseQcStore((s) => s.selectedReason);
  const remarks = useKarenPackhouseQcStore((s) => s.remarks);
  const submitting = useKarenPackhouseQcStore((s) => s.submitting);

  const loadInitialData = useKarenPackhouseQcStore((s) => s.loadInitialData);
  const setQcType = useKarenPackhouseQcStore((s) => s.setQcType);
  const setOnlineMode = useKarenPackhouseQcStore((s) => s.setOnlineMode);
  const selectCustomer = useKarenPackhouseQcStore((s) => s.selectCustomer);
  const selectSpecificationFilter = useKarenPackhouseQcStore((s) => s.selectSpecificationFilter);
  const selectedTeamFilter = useKarenPackhouseQcStore((s) => s.selectedTeamFilter);
  const selectTeamFilter = useKarenPackhouseQcStore((s) => s.selectTeamFilter);
  const selectOrderPickList = useKarenPackhouseQcStore((s) => s.selectOrderPickList);
  const scanBoxLabel = useKarenPackhouseQcStore((s) => s.scanBoxLabel);
  const scanAirportReturn = useKarenPackhouseQcStore((s) => s.scanAirportReturn);
  const airportReturn = useKarenPackhouseQcStore((s) => s.airportReturn);
  const setAirportReturnField = useKarenPackhouseQcStore((s) => s.setAirportReturnField);
  const startBunchSampling = useKarenPackhouseQcStore((s) => s.startBunchSampling);
  const setBunchesAccepted = useKarenPackhouseQcStore((s) => s.setBunchesAccepted);
  const addBunchRejection = useKarenPackhouseQcStore((s) => s.addBunchRejection);
  const setBunchRejectionBunches = useKarenPackhouseQcStore((s) => s.setBunchRejectionBunches);
  const removeBunchRejection = useKarenPackhouseQcStore((s) => s.removeBunchRejection);
  const bunchRejections = useKarenPackhouseQcStore((s) => s.bunchRejections);
  const finishBunchSampling = useKarenPackhouseQcStore((s) => s.finishBunchSampling);
  const isBunchSamplingMode = useKarenPackhouseQcStore((s) => s.isBunchSamplingMode);
  const setBoxesChecked = useKarenPackhouseQcStore((s) => s.setBoxesChecked);
  const setFinalDecision = useKarenPackhouseQcStore((s) => s.setFinalDecision);
  const isBoxSamplingMode = useKarenPackhouseQcStore((s) => s.isBoxSamplingMode);
  const addIssueForParam = useKarenPackhouseQcStore((s) => s.addIssueForParam);
  const updateIssueCount = useKarenPackhouseQcStore((s) => s.updateIssueCount);
  const removeIssue = useKarenPackhouseQcStore((s) => s.removeIssue);
  const setTotalChecked = useKarenPackhouseQcStore((s) => s.setTotalChecked);
  const setQcIncharge = useKarenPackhouseQcStore((s) => s.setQcIncharge);
  const setReason = useKarenPackhouseQcStore((s) => s.setReason);
  const setRemarks = useKarenPackhouseQcStore((s) => s.setRemarks);
  const canSubmit = useKarenPackhouseQcStore((s) => s.canSubmit);
  const submitPackhouseQc = useKarenPackhouseQcStore((s) => s.submitPackhouseQc);
  const resetAll = useKarenPackhouseQcStore((s) => s.resetAll);

  useEffect(() => {
    loadInitialData();
    return () => resetAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Every QC workflow is logged by whoever is holding the device — no need
  // to pick from a list of QC Incharges.
  useEffect(() => {
    if (qcType && loggedInEmail && selectedQcIncharge !== loggedInEmail) {
      setQcIncharge(loggedInEmail);
    }
  }, [qcType, loggedInEmail, selectedQcIncharge, setQcIncharge]);

  const availableWorkflows = WORKFLOW_OPTIONS.filter((w) => hasRole(w.role));
  const activeWorkflow = WORKFLOW_OPTIONS.find((w) => w.qcType === qcType && w.onlineMode === onlineMode) ?? null;
  const hasWorkflow = !!qcType && (qcType !== 'Online QC' || !!onlineMode);

  // If the operator only has one QC role, there's nothing to choose.
  useEffect(() => {
    if (!hasWorkflow && availableWorkflows.length === 1) {
      const only = availableWorkflows[0];
      setQcType(only.qcType);
      if (only.onlineMode) setOnlineMode(only.onlineMode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasWorkflow, availableWorkflows.length]);

  const countLabel = issueCountLabel(onlineMode, qcType);
  const overallResult = computeOverallResult(issues, selectedOrderPickList?.totalStems ?? 0);
  const selectedReasonOption = reasons.find((r) => r.name === selectedReason) ?? null;
  const issuesTotal = issues.reduce((sum, i) => sum + i.count, 0);
  const orderTotalBunches = totalBunches(itemLocations);
  // QC parameters grouped into their inspection categories, ordered by category
  // then name — drives the sectioned parameter / rejection-reason picker.
  const paramPickerOptions = params
    .map((p) => ({ value: p.name, label: p.parameter, group: categoryForParam(p.name) }))
    .sort((a, b) => categoryOrder(a.group) - categoryOrder(b.group) || a.label.localeCompare(b.label));
  const acceptedBunchesNum = Number.parseInt(bunchSampling.acceptedBunches, 10) || 0;
  const rejectedBunchesTotal = bunchRejections.reduce((sum, r) => sum + (Number.parseInt(r.bunches, 10) || 0), 0);
  const bunchesInspected = acceptedBunchesNum + rejectedBunchesTotal;
  const gradingQcMode = isBunchSamplingMode();
  const boxSamplingMode = isBoxSamplingMode();
  // Reject Recorder deals only in stems (no bunches), and doesn't need the
  // rubber-band spec check.
  const rejectRecorderMode = qcType === 'Online QC' && onlineMode === 'Reject Recorder';
  const boxSampleTarget = suggestedBoxSampleSize(boxTotalCount);
  // The directly picked/overridden spec wins — it covers orders whose own
  // Sales Order Item has no Specification link at all (common in Final
  // QC's scan-based flow), which the per-variety lookup can't find.
  const specification = specificationDetail ?? currentSpecification();
  const customerOptions = customerOptionsFn();
  const specsForCustomer = specificationsForSelectedCustomer();
  const airportReuseNum = Number.parseInt(airportReturn.reuseStems, 10) || 0;
  const airportRejectNum = Number.parseInt(airportReturn.rejectStems, 10) || 0;
  const airportDispositioned = airportReuseNum + airportRejectNum;
  const stemsPerBox = packRatePerBox(boxes, specification);
  // Final QC: every bunch in the sampled boxes is inspected. An issue whose
  // affected bunches breach its parameter's tolerance quarantines the WHOLE
  // order; in-tolerance issues are partial rejects of just those bunches.
  const boxesCheckedNum = Number.parseInt(boxesChecked, 10) || boxSampleTarget;
  const bunchesPerBox = specification?.bunchesPerBox ?? 0;
  const sampledBunchCount = sampledBunches(boxesCheckedNum, bunchesPerBox);
  const stemsPerBunchVal =
    specification?.stemsPerBunch && specification.stemsPerBunch > 0
      ? specification.stemsPerBunch
      : stemsPerBunch(itemLocations);
  const issueThresholdFor = (paramName: string) => params.find((p) => p.name === paramName)?.toleranceThresholds ?? 0;
  const issueBreached = (issue: IssueRow) =>
    isThresholdBreached(issue.count, sampledBunchCount, issueThresholdFor(issue.paramName));
  // Outside Final QC, issues are counted in stems. The parameter's % tolerance
  // is measured against what was actually checked: for Grading QC that's the
  // bunches inspected (converted to stems); elsewhere the order's full stem
  // total. Null/zero total → show the threshold only, no over/within verdict.
  const totalStemsChecked = gradingQcMode
    ? bunchesInspected * stemsPerBunchVal
    : selectedOrderPickList?.totalStems ?? 0;
  const issueToleranceInfo = (issue: IssueRow) => {
    const thresholdPercent = issueThresholdFor(issue.paramName);
    const affectedPercent = totalStemsChecked > 0 ? (issue.count / totalStemsChecked) * 100 : null;
    return {
      thresholdPercent,
      affectedPercent,
      breached: totalStemsChecked > 0 && isThresholdBreached(issue.count, totalStemsChecked, thresholdPercent),
    };
  };
  // Total bunches recorded — all of them are partial-rejected when the
  // decision is Accept.
  const allIssueBunches = issues.reduce((sum, i) => sum + i.count, 0);
  const finalQcDisposition: PackhouseOverallResult =
    effectiveDecision === 'Reject' ? 'Rejected' : effectiveDecision === 'Quarantine' ? 'Quarantined' : 'Accepted';
  const readyToSubmit = canSubmit();

  const onSubmit = async () => {
    const outcome = await submitPackhouseQc();
    if (outcome.kind === 'ok') {
      showSuccess(outcome.message);
      resetAll();
      loadInitialData();
    } else {
      showError(outcome.message);
    }
  };

  const onScanBox = async (raw: string) => {
    const result = await scanBoxLabel(raw);
    if (!result.ok) showError(result.message ?? 'Failed to resolve box.');
    else setBoxScanValue('');
  };

  const onScanAirportReturn = async (raw: string) => {
    const result = await scanAirportReturn(raw);
    if (!result.ok) showError(result.message ?? 'Failed to resolve box.');
    else setBoxScanValue('');
  };

  // ── Landing: pick a workflow ────────────────────────────────────────────
  if (!hasWorkflow) {
    return (
      <Screen title="Packhouse QC">
        <View style={s.landingHeader}>
          <Text style={s.landingTitle}>Select Workflow</Text>
          <Text style={s.landingSubtitle}>Choose which quality check you&apos;re doing.</Text>
        </View>

        {availableWorkflows.length === 0 ? (
          <Alert tone="danger">
            No QC role assigned to your account. Contact your administrator to be granted Reject
            Recorder, Grading QC, or Final QC access.
          </Alert>
        ) : (
          availableWorkflows.map((w) => (
            <Pressable
              key={w.key}
              onPress={() => {
                setQcType(w.qcType);
                if (w.onlineMode) setOnlineMode(w.onlineMode);
              }}
              style={({ pressed }) => [s.workflowTile, pressed && s.workflowTilePressed]}
            >
              <View style={s.workflowIconWrap}>
                <Ionicons name={w.icon} size={24} color={COLORS.text} />
              </View>
              <View style={s.workflowTextWrap}>
                <Text style={s.workflowLabel}>{w.label}</Text>
                <Text style={s.workflowDescription}>{w.description}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
            </Pressable>
          ))
        )}
      </Screen>
    );
  }

  // ── Active workflow: one continuous scrolling page ──────────────────────
  return (
    <Screen
      title="Packhouse QC"
      footer={
        <Button
          label={submitting ? 'Submitting…' : 'SUBMIT'}
          loading={submitting}
          disabled={!readyToSubmit}
          onPress={onSubmit}
          style={{ height: 56 }}
        />
      }
    >
      <View style={s.activeHeader}>
        <View style={s.activeHeaderIconWrap}>
          <Ionicons name={activeWorkflow?.icon ?? 'checkmark-circle-outline'} size={20} color={COLORS.text} />
        </View>
        <Text style={s.activeHeaderLabel} numberOfLines={1}>
          {activeWorkflow?.label ?? qcType}
        </Text>
        <Pressable onPress={resetAll} hitSlop={8}>
          <Text style={s.changeLink}>Change</Text>
        </Pressable>
      </View>

      <SectionLabel label="Order" />

      {qcType === 'Final QC' ? (
        <Card title="Scan Box">
          <Text style={s.hint}>
            Scan the box&apos;s QR code — its order and specification autopopulate below.
          </Text>
          <View style={{ height: 12 }} />
          <ScanField
            value={boxScanValue}
            onChangeText={setBoxScanValue}
            onScan={onScanBox}
            placeholder="Scan or type box code"
            editable={!orderDetailLoading}
          />
        </Card>
      ) : qcType === 'Airport Returns' ? (
        <Card title="Scan Returned Box">
          <Text style={s.hint}>
            Scan the returned box&apos;s QR code — its order, customer, variety and stock details
            autopopulate below.
          </Text>
          <View style={{ height: 12 }} />
          <ScanField
            value={boxScanValue}
            onChangeText={setBoxScanValue}
            onScan={onScanAirportReturn}
            placeholder="Scan or type box code"
            editable={!orderDetailLoading}
          />
        </Card>
      ) : (
        <>
          <Card title="Customer">
            <Text style={s.hint}>Pick the customer first — its specifications are listed next.</Text>
            <View style={{ height: 12 }} />
            <Pressable
              onPress={() => setCustomerPickerOpen(true)}
              style={s.pickerRow}
              disabled={loadingInitial || customerOptions.length === 0}
            >
              <MaterialCommunityIcons name="domain" size={18} color={COLORS.textMuted} />
              <Text style={s.pickerText} numberOfLines={1}>
                {loadingInitial ? 'Loading…' : selectedCustomer ?? 'Select customer'}
              </Text>
              <MaterialCommunityIcons name="chevron-down" size={20} color={COLORS.textMuted} />
            </Pressable>
          </Card>

          <Card title="Specification">
            {!selectedCustomer ? (
              <Text style={s.hint}>Select a customer above to see its specifications.</Text>
            ) : (
              <>
                <Text style={s.hint}>
                  Pick the spec this order should have been packed against — the order list below is
                  filtered to it.
                </Text>
                <View style={{ height: 12 }} />
                <Pressable
                  onPress={() => setSpecPickerOpen(true)}
                  style={s.pickerRow}
                  disabled={specsForCustomer.length === 0}
                >
                  <MaterialCommunityIcons name="file-document-outline" size={18} color={COLORS.textMuted} />
                  <Text style={s.pickerText} numberOfLines={1}>
                    {selectedSpecificationFilter
                      ? selectedSpecificationFilter.specName
                      : specsForCustomer.length === 0
                        ? 'No specifications for this customer'
                        : 'Select specification'}
                  </Text>
                  <MaterialCommunityIcons name="chevron-down" size={20} color={COLORS.textMuted} />
                </Pressable>
              </>
            )}
          </Card>

          {/* Once a spec is picked the next step is the Order Pick List, so hide
              the team alternative to avoid it reading as the next step. */}
          {!selectedSpecificationFilter ? (
            <Card title="No specification? Filter by team">
              <Text style={s.hint}>
                Some orders have no specification and never appear above — pick a team to QC those.
              </Text>
              <View style={{ height: 12 }} />
              <Pressable onPress={() => setTeamPickerOpen(true)} style={s.pickerRow}>
                <MaterialCommunityIcons name="account-group-outline" size={18} color={COLORS.textMuted} />
                <Text style={s.pickerText} numberOfLines={1}>
                  {selectedTeamFilter ?? 'Select team'}
                </Text>
                <MaterialCommunityIcons name="chevron-down" size={20} color={COLORS.textMuted} />
              </Pressable>
            </Card>
          ) : null}

          <Card title="Order Pick List">
            {!(selectedSpecificationFilter || selectedTeamFilter) ? (
              <Text style={s.hint}>Pick a specification or a team above to see orders.</Text>
            ) : (
              <Pressable
                onPress={() => setOrderPickerOpen(true)}
                style={s.pickerRow}
                disabled={orderPickListsLoading}
              >
                <MaterialCommunityIcons name="clipboard-text-outline" size={18} color={COLORS.textMuted} />
                <Text style={s.pickerText} numberOfLines={1}>
                  {orderPickListsLoading
                    ? 'Loading…'
                    : selectedOrderPickList
                      ? selectedOrderPickList.orderName || selectedOrderPickList.name
                      : orderPickLists.length === 0
                        ? selectedTeamFilter
                          ? 'No spec-less orders for this team'
                          : 'No orders found for this spec'
                        : 'Select order pick list'}
                </Text>
                <MaterialCommunityIcons name="chevron-down" size={20} color={COLORS.textMuted} />
              </Pressable>
            )}
          </Card>
        </>
      )}

      {selectedOrderPickList ? (
        <Card title={qcType === 'Final QC' ? 'Order' : 'Order Detail'}>
          <View style={s.chipRow}>
            <View style={s.chip}>
              <Text style={s.chipText}>{selectedOrderPickList.customer}</Text>
            </View>
            <View style={s.chip}>
              <Text style={s.chipText}>Team: {selectedOrderPickList.team}</Text>
            </View>
          </View>
          <Text style={s.muted}>Line: {selectedOrderPickList.orderName || selectedOrderPickList.name}</Text>
          <Text style={s.muted}>
            Farm: {selectedOrderPickList.farm} · {selectedOrderPickList.totalStems} total stems
          </Text>
          {selectedOrderPickList.scheduleNumber ? (
            <Text style={s.muted}>Consignment No: {selectedOrderPickList.scheduleNumber}</Text>
          ) : null}
          {orderDetailLoading ? (
            <Text style={s.muted}>Loading order detail…</Text>
          ) : (
            <>
              {itemLocations.length > 0 ? <Text style={s.muted}>Total Bunches: {orderTotalBunches}</Text> : null}
              {qcType === 'Final QC' && boxTotalCount > 0 ? (
                <Text style={s.muted}>
                  Total Boxes: {boxTotalCount} · Suggested sample (30%): {boxSampleTarget}
                </Text>
              ) : null}
            </>
          )}
          {pendingQuarantineStems > 0 ? (
            <>
              <View style={{ height: 8 }} />
              <Text style={s.warn}>{pendingQuarantineStems} stems in quarantine — pending rework</Text>
            </>
          ) : null}

          {/* Variety reads like the other order facts above — no
              workflow lets the operator pick a different one anymore, so
              it's never a select field. */}
          <Text style={s.muted}>
            Variety: {orderDetailLoading ? 'Loading…' : selectedVariety || 'Not found'}
          </Text>
        </Card>
      ) : null}

      {qcType === 'Final QC' && scannedBoxName ? (
        <Card title="Scanned Box">
          <Text style={s.muted}>Resolved from box: {scannedBoxName}</Text>
          {scannedBoxDetail ? (
            <>
              <View style={{ height: 8 }} />
              <Text style={s.hint}>What&apos;s recorded on this box — compare against the spec below.</Text>
              <View style={{ height: 8 }} />
              <View style={s.chipRow}>
                <View style={s.chip}>
                  <Text style={s.chipText}>
                    Box {scannedBoxDetail.boxNumber || '—'} of {scannedBoxDetail.boxTotalCount || '—'}
                  </Text>
                </View>
                <View style={s.chip}>
                  <Text style={s.chipText}>Pack rate: {scannedBoxDetail.packRate || '—'}</Text>
                </View>
                {scannedBoxDetail.length ? (
                  <View style={s.chip}>
                    <Text style={s.chipText}>Length: {scannedBoxDetail.length}</Text>
                  </View>
                ) : null}
              </View>
              {scannedBoxDetail.items.map((item, idx) => (
                <Text key={idx} style={s.muted}>
                  {item.variety || 'Variety —'} · {item.qty || 0} stems · {item.length || '—'}
                </Text>
              ))}
            </>
          ) : null}
        </Card>
      ) : null}

      {qcType === 'Final QC' && selectedOrderPickList && !specification ? (
        <Card title="Specification">
          <Text style={s.muted}>No specification found for this order.</Text>
        </Card>
      ) : null}

      {specification && qcType !== 'Airport Returns' ? (
        <Card title="Order Specification">
          <Text style={s.section}>{specification.specName}</Text>
          <Text style={s.hint}>Compare what was packed against every line below.</Text>
          <View style={{ height: 12 }} />

          <View style={s.chipRow}>
            <View style={s.chip}>
              <Text style={s.chipText}>{specification.status || '—'}</Text>
            </View>
            <View style={s.chip}>
              <Text style={s.chipText}>{specification.specType || '—'}</Text>
            </View>
            <View style={s.chip}>
              <Text style={s.chipText}>{specification.ftnft || '—'}</Text>
            </View>
            <View style={s.chip}>
              <Text style={s.chipText}>{specification.boxAssortment || '—'}</Text>
            </View>
          </View>

          <Text style={s.muted}>Customer: {specification.customer || '—'}</Text>
          <Text style={s.muted}>Category Code: {specification.categoryCode || '—'}</Text>

          <View style={{ height: 12 }} />
          <Text style={s.section}>VERIFY AGAINST THE BOX</Text>
          <View style={{ height: 8 }} />
          <SpecCheckRow
            label="Cut Stage"
            expected={specification.cutStage}
            check={specChecks.cutStage}
            affectedInStems={rejectRecorderMode}
            onAccept={() => acceptSpecCheck('cutStage')}
            onActualValueChange={(v) => setSpecCheckActualValue('cutStage', v)}
            onBunchesAffectedChange={(v) => setSpecCheckBunchesAffected('cutStage', v)}
          />
          <SpecCheckRow
            label="Defoliation Length"
            expected={specification.defoliationLength}
            check={specChecks.defoliationLength}
            affectedInStems={rejectRecorderMode}
            onAccept={() => acceptSpecCheck('defoliationLength')}
            onActualValueChange={(v) => setSpecCheckActualValue('defoliationLength', v)}
            onBunchesAffectedChange={(v) => setSpecCheckBunchesAffected('defoliationLength', v)}
          />
          {/* Reject Recorder doesn't verify rubber band — only Grading / Final QC do. */}
          {!rejectRecorderMode ? (
            <SpecCheckRow
              label="Rubber Band"
              expected={[
                specification.rubberBandType,
                specification.rubberBandDistance1 ? `${specification.rubberBandDistance1} from base` : '',
                specification.rubberBandDistance2 ? `2nd band ${specification.rubberBandDistance2}` : '',
              ]
                .filter(Boolean)
                .join(' · ')}
              check={specChecks.rubberBand}
              onAccept={() => acceptSpecCheck('rubberBand')}
              onActualValueChange={(v) => setSpecCheckActualValue('rubberBand', v)}
              onBunchesAffectedChange={(v) => setSpecCheckBunchesAffected('rubberBand', v)}
            />
          ) : null}
          {specification.validFrom || specification.expiryDate ? (
            <Text style={s.muted}>
              Valid: {specification.validFrom || '—'} to {specification.expiryDate || 'no expiry'}
            </Text>
          ) : null}
          {specification.boxItems.length > 0 ? (
            <>
              <View style={{ height: 12 }} />
              <Text style={s.section}>BOX ITEMS</Text>
              <View style={{ height: 8 }} />
              {specification.boxItems.map((bi, idx) => (
                <View key={idx} style={s.issueCard}>
                  <Text style={s.issueTitle}>
                    {bi.variety || 'Variety —'} · {bi.colour || '—'}
                  </Text>
                  <View style={{ height: 6 }} />
                  <Text style={s.muted}>
                    {bi.bunchType || '—'} · {bi.length || '—'} · {bi.stemsPerBunch || '—'} stems/bunch ·{' '}
                    {bi.bunchesPerBox || '—'} bunches/box · pack rate {bi.packRate || '—'}
                  </Text>
                  <Text style={s.muted}>
                    Box Type: {bi.boxType || '—'} · HZ/Bud Count: {bi.hzBudCountRange || '—'}
                  </Text>
                </View>
              ))}
            </>
          ) : null}

          {specification.consumables.length > 0 ? (
            <>
              <Text style={s.section}>CONSUMABLES</Text>
              <View style={{ height: 8 }} />
              {specification.consumables.map((c, idx) => (
                <View key={idx} style={s.chipRow}>
                  <View style={s.chip}>
                    <Text style={s.chipText}>{c.consumableType}</Text>
                  </View>
                  <Text style={s.muted}>
                    {c.qtyPerBunch ? `${c.qtyPerBunch}/bunch` : ''}
                    {c.qtyPerBunch && c.qtyPerBox ? ' · ' : ''}
                    {c.qtyPerBox ? `${c.qtyPerBox}/box` : ''}
                  </Text>
                </View>
              ))}
            </>
          ) : null}
        </Card>
      ) : null}

      {selectedOrderPickList && qcType === 'Airport Returns' ? (
        <>
          <SectionLabel label="Airport Return" />

          <Card title="Return Details">
            <Text style={s.hint}>Fetched from the scanned box — edit any that need correcting.</Text>
            <View style={{ height: 12 }} />
            <LabeledInput
              label="Invoice Number"
              iconName="receipt"
              value={airportReturn.invoiceNumber}
              onChangeText={(v) => setAirportReturnField('invoiceNumber', v)}
              placeholder="Invoice #"
            />
            <View style={{ height: 10 }} />
            <View style={s.chipRow}>
              <View style={s.chip}>
                <Text style={s.chipText}>{selectedOrderPickList.customer}</Text>
              </View>
              <View style={s.chip}>
                <Text style={s.chipText}>{selectedVariety ?? '—'}</Text>
              </View>
              {scannedBoxDetail?.length ? (
                <View style={s.chip}>
                  <Text style={s.chipText}>{scannedBoxDetail.length}</Text>
                </View>
              ) : null}
            </View>
            <Text style={s.muted}>Order: {selectedOrderPickList.orderName || selectedOrderPickList.name}</Text>
            <Text style={s.muted}>
              Stems returned: {airportReturn.stemsReturned || '—'} · Days in stock:{' '}
              {airportReturn.daysInStock || '—'}
            </Text>
            <View style={{ height: 10 }} />
            <LabeledInput
              label="Farm"
              iconName="barn"
              value={airportReturn.farm}
              onChangeText={(v) => setAirportReturnField('farm', v)}
              placeholder="Farm"
            />
            <View style={{ height: 8 }} />
            <LabeledInput
              label="Greenhouse"
              iconName="greenhouse"
              value={airportReturn.greenhouse}
              onChangeText={(v) => setAirportReturnField('greenhouse', v)}
              placeholder="Greenhouse"
            />
          </Card>

          <Card title="Inspection">
            <Text style={s.hint}>Pick the reason, then record inspected stems and how they were dispositioned.</Text>
            <View style={{ height: 12 }} />
            <Pressable
              onPress={() => setAirportReasonPickerOpen(true)}
              style={s.pickerRow}
              disabled={params.length === 0}
            >
              <MaterialCommunityIcons name="alert-circle-outline" size={18} color={COLORS.textMuted} />
              <Text style={s.pickerText} numberOfLines={1}>
                {airportReturn.reason || (params.length === 0 ? 'Loading reasons…' : 'Select reason')}
              </Text>
              <MaterialCommunityIcons name="chevron-down" size={20} color={COLORS.textMuted} />
            </Pressable>
            <View style={{ height: 12 }} />
            <LabeledInput
              label="Inspected Stems"
              iconName="counter"
              value={airportReturn.inspectedStems}
              onChangeText={(v) => setAirportReturnField('inspectedStems', v)}
              keyboardType="number-pad"
              placeholder="0"
            />
            <View style={{ height: 8 }} />
            <LabeledInput
              label="Reuse — stems affected"
              iconName="recycle"
              value={airportReturn.reuseStems}
              onChangeText={(v) => setAirportReturnField('reuseStems', v)}
              keyboardType="number-pad"
              placeholder="0"
            />
            <View style={{ height: 8 }} />
            <LabeledInput
              label="Reject — stems affected"
              iconName="close-circle-outline"
              value={airportReturn.rejectStems}
              onChangeText={(v) => setAirportReturnField('rejectStems', v)}
              keyboardType="number-pad"
              placeholder="0"
            />
            {airportDispositioned > 0 ? (
              <>
                <View style={{ height: 8 }} />
                <Text style={s.muted}>
                  Reuse {airportReuseNum} → shelved to the Kapkolia cold room (age/farm/greenhouse kept)
                  {airportRejectNum > 0 ? ` · Reject ${airportRejectNum} → rejects` : ''}.
                </Text>
              </>
            ) : null}
          </Card>

          <Card title="QC Incharge">
            <Text style={s.muted}>{loggedInFullName || loggedInEmail || '—'}</Text>
          </Card>
        </>
      ) : null}

      {selectedOrderPickList && qcType !== 'Airport Returns' ? (
        <>
        <SectionLabel label="Quality Check" />

        {gradingQcMode ? (
          <Card title="Bunch Inspection">
            <Text style={s.muted}>
              {orderTotalBunches > 0 ? `${orderTotalBunches} total bunches in this order. ` : ''}
              Enter how many bunches you accepted, then add a row for each rejection reason with the
              bunches it affected. Finish sampling when done.
            </Text>
            <View style={{ height: 16 }} />

            {!bunchSampling.started ? (
              <Button label="Start Bunch Sampling" onPress={startBunchSampling} />
            ) : (
              <>
                <LabeledInput
                  label="Bunches Accepted"
                  iconName="check-circle-outline"
                  value={bunchSampling.acceptedBunches}
                  onChangeText={setBunchesAccepted}
                  keyboardType="number-pad"
                  placeholder="0"
                  editable={!bunchSampling.finished}
                />

                <View style={{ height: 16 }} />
                <Text style={s.section}>REJECTIONS ({bunchRejections.length})</Text>
                <View style={{ height: 8 }} />
                {bunchRejections.length === 0 ? (
                  <Text style={s.empty}>No rejections recorded.</Text>
                ) : (
                  bunchRejections.map((r) => {
                    const param = params.find((p) => p.name === r.reason);
                    return (
                      <BunchRejectionRow
                        key={r.id}
                        displayName={param?.parameter ?? r.reason}
                        bunches={r.bunches}
                        thresholdPercent={issueThresholdFor(r.reason)}
                        editable={!bunchSampling.finished}
                        onBunchesChange={(v) => setBunchRejectionBunches(r.id, v)}
                        onRemove={() => removeBunchRejection(r.id)}
                      />
                    );
                  })
                )}

                {!bunchSampling.finished ? (
                  <>
                    <View style={{ height: 8 }} />
                    <Pressable
                      onPress={() => {
                        setPendingSampleUnit('bunch');
                        setParamPickerOpen(true);
                      }}
                      style={s.pickerRow}
                      disabled={params.length === 0}
                    >
                      <MaterialCommunityIcons name="plus-circle-outline" size={18} color={COLORS.textMuted} />
                      <Text style={s.pickerText} numberOfLines={1}>
                        {params.length === 0 ? 'Loading reasons…' : 'Add rejection reason'}
                      </Text>
                      <MaterialCommunityIcons name="chevron-down" size={20} color={COLORS.textMuted} />
                    </Pressable>
                  </>
                ) : null}

                <View style={{ height: 16 }} />
                <View style={s.chipRow}>
                  <View style={s.chip}>
                    <Text style={s.chipText}>Inspected: {bunchesInspected}</Text>
                  </View>
                  <View style={s.chip}>
                    <Text style={s.chipText}>Accepted: {acceptedBunchesNum}</Text>
                  </View>
                  <View style={[s.chip, s.chipDanger]}>
                    <Text style={s.chipText}>Rejected: {rejectedBunchesTotal}</Text>
                  </View>
                </View>

                {!bunchSampling.finished ? (
                  <>
                    <View style={{ height: 16 }} />
                    <Button
                      label="Finish Sampling"
                      variant="outline"
                      onPress={finishBunchSampling}
                      disabled={bunchesInspected === 0}
                    />
                  </>
                ) : (
                  <>
                    <View style={{ height: 8 }} />
                    <Text style={s.warn}>Sampling finished for this order.</Text>
                  </>
                )}
              </>
            )}
          </Card>
        ) : null}

        {boxSamplingMode ? (
          <Card title="Boxes Checked">
            <Text style={s.hint}>
              {boxTotalCount > 0 ? `${boxTotalCount} total boxes · suggested sample (30%): ${boxSampleTarget}. ` : ''}
              Inspect every bunch in the sampled boxes, then record issues below in bunches.
            </Text>
            <View style={{ height: 12 }} />
            <LabeledInput
              label="Boxes Checked"
              iconName="counter"
              value={boxesChecked}
              onChangeText={setBoxesChecked}
              keyboardType="number-pad"
              placeholder={boxSampleTarget ? `${boxSampleTarget}` : '0'}
            />
            {sampledBunchCount > 0 ? (
              <Text style={s.muted}>
                ≈ {sampledBunchCount} bunches inspected ({boxesCheckedNum} × {bunchesPerBox}/box)
                {stemsPerBunchVal > 0 ? ` · ${stemsPerBunchVal} stems/bunch` : ''}
              </Text>
            ) : stemsPerBox > 1 ? (
              <Text style={s.muted}>Each box ≈ {stemsPerBox} stems, per the order specification.</Text>
            ) : (
              <Text style={s.warn}>
                Bunches-per-box unknown for this spec — any recorded issue will quarantine the order.
              </Text>
            )}
          </Card>
        ) : null}

        {!gradingQcMode ? (
          <Card title="Add Issue">
            <Text style={s.hint}>Select a parameter to add it to the issues list below.</Text>
            <View style={{ height: 12 }} />
            <Pressable onPress={() => setParamPickerOpen(true)} style={s.pickerRow} disabled={params.length === 0}>
              <MaterialCommunityIcons name="alert-circle-outline" size={18} color={COLORS.textMuted} />
              <Text style={s.pickerText} numberOfLines={1}>
                {params.length === 0 ? 'Loading concern types…' : 'Select parameter'}
              </Text>
              <MaterialCommunityIcons name="chevron-down" size={20} color={COLORS.textMuted} />
            </Pressable>

            <View style={{ height: 8 }} />
            <Text style={s.section}>ISSUES ({issues.length})</Text>
            <View style={{ height: 8 }} />
            {issues.length === 0 ? (
              <Text style={s.empty}>No issues added yet</Text>
            ) : (
              issues.map((issue) => {
                const param = params.find((p) => p.name === issue.paramName);
                return (
                  <IssueRowCard
                    key={issue.id}
                    issue={issue}
                    displayName={param?.parameter ?? issue.paramName}
                    countLabel={countLabel}
                    onRemove={() => removeIssue(issue.id)}
                    onCountChange={(n) => updateIssueCount(issue.id, n)}
                    showAction={!boxSamplingMode}
                    toleranceInfo={issueToleranceInfo(issue)}
                    tolerance={
                      boxSamplingMode
                        ? {
                            thresholdPercent: issueThresholdFor(issue.paramName),
                            affectedBunches: issue.count,
                            sampled: sampledBunchCount,
                            breached: issueBreached(issue),
                          }
                        : undefined
                    }
                  />
                );
              })
            )}
          </Card>
        ) : null}

        {boxSamplingMode ? (
          <Card title="Decision">
            <Text style={s.hint}>
              Auto-set from the tolerance checks — override if the sample tells you otherwise.
              Quarantine and Reject apply to the WHOLE order, not just the sampled boxes.
            </Text>
            <View style={{ height: 12 }} />
            <View style={s.actionRow}>
              <DecisionChip
                label="Accept"
                selected={effectiveDecision === 'Accept'}
                onPress={() => setFinalDecision('Accept')}
              />
              <DecisionChip
                label="Quarantine"
                selected={effectiveDecision === 'Quarantine'}
                onPress={() => setFinalDecision('Quarantine')}
              />
              <DecisionChip
                label="Reject"
                selected={effectiveDecision === 'Reject'}
                onPress={() => setFinalDecision('Reject')}
              />
            </View>
            <View style={{ height: 8 }} />
            <Text style={s.muted}>
              {finalDecisionOverride === null
                ? `Auto-suggested (${effectiveDecision}) from the tolerance checks.`
                : 'Manual override.'}
            </Text>
          </Card>
        ) : null}

        <SectionLabel label="Review & Submit" />

        <Card title="Summary">
          <Text style={s.muted}>
            {qcType}
            {onlineMode ? ` · ${onlineMode}` : ''} · {selectedOrderPickList?.orderName}
          </Text>
          <View style={{ height: 12 }} />
          {boxSamplingMode ? (
            <>
              <Text style={effectiveDecision === 'Accept' ? s.empty : s.warn}>
                {effectiveDecision === 'Accept'
                  ? issues.length === 0
                    ? 'Accepted — no issues found.'
                    : `Accepted — ${allIssueBunches} bunch(es) rejected; the rest of the order passes.`
                  : effectiveDecision === 'Quarantine'
                    ? `Quarantined — whole order (${selectedOrderPickList?.totalStems ?? 0} stems) held for rework.`
                    : `Rejected — whole order (${selectedOrderPickList?.totalStems ?? 0} stems) rejected.`}
              </Text>
              {issues.length > 0 ? (
                <>
                  <View style={{ height: 8 }} />
                  {issues.map((issue) => {
                    const param = params.find((p) => p.name === issue.paramName);
                    return (
                      <IssueRowCard
                        key={issue.id}
                        issue={issue}
                        displayName={param?.parameter ?? issue.paramName}
                        onRemove={() => removeIssue(issue.id)}
                        showAction={false}
                        tolerance={{
                          thresholdPercent: issueThresholdFor(issue.paramName),
                          affectedBunches: issue.count,
                          sampled: sampledBunchCount,
                          breached: issueBreached(issue),
                        }}
                      />
                    );
                  })}
                </>
              ) : null}
            </>
          ) : issues.length === 0 ? (
            <Text style={s.empty}>No issues recorded — clean check.</Text>
          ) : (
            issues.map((issue) => {
              const param = params.find((p) => p.name === issue.paramName);
              return (
                <IssueRowCard
                  key={issue.id}
                  issue={issue}
                  displayName={param?.parameter ?? issue.paramName}
                  onRemove={() => removeIssue(issue.id)}
                  toleranceInfo={issueToleranceInfo(issue)}
                />
              );
            })
          )}
        </Card>

        {gradingQcMode ? (
          <Card title="Stems Checked">
            <Text style={s.muted}>
              Accepted / Rejected is computed against this order&apos;s full{' '}
              {selectedOrderPickList?.totalStems ?? 0} stems, not a manually entered sample.
            </Text>
          </Card>
        ) : !boxSamplingMode ? (
          <Card title="Total Stems Checked">
            <LabeledInput
              label="Total Stems Checked"
              iconName="counter"
              value={totalChecked}
              onChangeText={setTotalChecked}
              keyboardType="number-pad"
              placeholder={`${issuesTotal} (sum of issues, if left blank)`}
            />
          </Card>
        ) : null}

        <Card title="Overall Reason (optional)">
          <Pressable onPress={() => setReasonPickerOpen(true)} style={s.pickerRow}>
            <MaterialCommunityIcons name="text-box-outline" size={18} color={COLORS.textMuted} />
            <Text style={s.pickerText} numberOfLines={1}>
              {selectedReasonOption ? selectedReasonOption.reason : 'Select overall reason'}
            </Text>
            <MaterialCommunityIcons name="chevron-down" size={20} color={COLORS.textMuted} />
          </Pressable>
        </Card>

        <Card title="QC Incharge">
          <View style={s.pickerRow}>
            <MaterialCommunityIcons name="account-outline" size={18} color={COLORS.textMuted} />
            <Text style={s.pickerText} numberOfLines={1}>
              {loggedInFullName || loggedInEmail || 'Logged-in user'}
            </Text>
          </View>
        </Card>

        <Card title="Remarks">
          <TextInput
            value={remarks}
            onChangeText={setRemarks}
            placeholder="Optional notes for this inspection"
            placeholderTextColor={COLORS.textMuted}
            multiline
            style={s.remarksInput}
          />
        </Card>

        <ResultBadge result={boxSamplingMode ? finalQcDisposition : overallResult} />
        </>
      ) : null}

      <PickerModal
        open={customerPickerOpen}
        title="Select Customer"
        onClose={() => setCustomerPickerOpen(false)}
        options={customerOptions.map((c) => ({ value: c, label: c }))}
        onPick={(value) => {
          selectCustomer(value);
          setCustomerPickerOpen(false);
        }}
      />

      <PickerModal
        open={specPickerOpen}
        title="Select Specification"
        onClose={() => setSpecPickerOpen(false)}
        options={specsForCustomer.map((spec) => {
          const orderCount = specOrderCounts[spec.name] ?? 0;
          return {
            value: spec.name,
            label: spec.specName,
            subtitle: [spec.boxAssortment, spec.cutStage].filter(Boolean).join(' · '),
            hasOrders: orderCount > 0,
            orderCount,
          };
        })}
        onPick={(value) => {
          const spec = specsForCustomer.find((sp) => sp.name === value);
          if (spec) {
            selectSpecificationFilter(spec);
          }
          setSpecPickerOpen(false);
        }}
      />

      <PickerModal
        open={teamPickerOpen}
        title="Select Team"
        onClose={() => setTeamPickerOpen(false)}
        options={TEAMS.map((t) => ({ value: t, label: t }))}
        onPick={(value) => {
          selectTeamFilter(value);
          setTeamPickerOpen(false);
        }}
      />

      <PickerModal
        open={orderPickerOpen}
        title="Select Order Pick List"
        onClose={() => setOrderPickerOpen(false)}
        options={orderPickLists.map((opl) => ({
          value: opl.name,
          label: opl.orderName || opl.name,
          subtitle: opl.customer,
        }))}
        onPick={(value) => {
          const opl = orderPickLists.find((o) => o.name === value);
          if (opl) selectOrderPickList(opl);
          setOrderPickerOpen(false);
        }}
      />


      <PickerModal
        open={paramPickerOpen}
        title={pendingSampleUnit ? 'Reason for Rejection' : 'Select Parameter'}
        onClose={() => {
          setParamPickerOpen(false);
          setPendingSampleUnit(null);
        }}
        options={paramPickerOptions}
        onPick={(value) => {
          if (pendingSampleUnit === 'bunch') {
            addBunchRejection(value);
          } else {
            addIssueForParam(value);
          }
          setPendingSampleUnit(null);
          setParamPickerOpen(false);
        }}
      />

      <PickerModal
        open={airportReasonPickerOpen}
        title="Reason for Return"
        onClose={() => setAirportReasonPickerOpen(false)}
        options={paramPickerOptions}
        onPick={(value) => {
          setAirportReturnField('reason', value);
          setAirportReasonPickerOpen(false);
        }}
      />

      <PickerModal
        open={reasonPickerOpen}
        title="Select Overall Reason"
        onClose={() => setReasonPickerOpen(false)}
        options={reasons.map((r) => ({ value: r.name, label: r.reason }))}
        onPick={(value) => {
          setReason(value);
          setReasonPickerOpen(false);
        }}
      />

    </Screen>
  );
}

function SpecCheckRow({
  label,
  expected,
  check,
  affectedInStems,
  onAccept,
  onActualValueChange,
  onBunchesAffectedChange,
}: {
  label: string;
  expected: string;
  check: SpecCheckState;
  /** Reject Recorder records the affected count in stems, not bunches. */
  affectedInStems?: boolean;
  onAccept: () => void;
  onActualValueChange: (value: string) => void;
  onBunchesAffectedChange: (value: string) => void;
}) {
  const affected = Number.parseInt(check.bunchesAffected, 10) || 0;
  const unit = affectedInStems ? 'stem' : 'bunch';
  const unitPlural = affectedInStems ? 'stems' : 'bunches';
  return (
    <View style={s.specCheckRow}>
      <View style={s.specCheckHead}>
        <Text style={s.muted}>
          {label}: {expected || '—'}
        </Text>
        <Pressable
          onPress={onAccept}
          style={[s.chip, check.accepted ? s.chipAccepted : null]}
          hitSlop={4}
        >
          <MaterialCommunityIcons
            name={check.accepted ? 'check-circle' : 'check-circle-outline'}
            size={14}
            color={check.accepted ? COLORS.success : COLORS.textMuted}
          />
          <Text style={[s.chipText, check.accepted ? { color: COLORS.success } : null]}>Accepted</Text>
        </Pressable>
      </View>
      {!check.accepted ? (
        <>
          <TextInput
            value={check.actualValue}
            onChangeText={onActualValueChange}
            placeholder={`Actual ${label.toLowerCase()} found on box, if different`}
            placeholderTextColor={COLORS.textMuted}
            style={s.specCheckInput}
          />
          <View style={s.specCheckAffectedRow}>
            <Text style={s.specCheckAffectedLabel}>{affectedInStems ? 'Stems affected' : 'Bunches affected'}</Text>
            <TextInput
              value={check.bunchesAffected}
              onChangeText={onBunchesAffectedChange}
              placeholder="0"
              keyboardType="number-pad"
              placeholderTextColor={COLORS.textMuted}
              style={s.specCheckAffectedInput}
            />
          </View>
          {affected > 0 ? (
            <View style={s.specCheckAffectedHintRow}>
              <MaterialCommunityIcons name="arrow-down-right" size={14} color={COLORS.danger} />
              <Text style={s.specCheckAffectedHint}>
                Added to the issues list as “{label}” — {affected} {affected === 1 ? unit : unitPlural}.
              </Text>
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

function SectionLabel({ label }: { label: string }) {
  return (
    <View style={s.sectionLabelWrap}>
      <View style={s.sectionLabelRule} />
      <Text style={s.sectionLabelText}>{label}</Text>
      <View style={s.sectionLabelRule} />
    </View>
  );
}

/** One Grading QC rejection reason — the operator types how many bunches it
 *  affected. The parameter's tolerance threshold is shown for reference; the
 *  affected/tolerance verdict lives on the Review summary's issue rows. */
function BunchRejectionRow({
  displayName,
  bunches,
  thresholdPercent,
  editable,
  onBunchesChange,
  onRemove,
}: {
  displayName: string;
  bunches: string;
  thresholdPercent: number;
  editable: boolean;
  onBunchesChange: (value: string) => void;
  onRemove: () => void;
}) {
  return (
    <View style={s.issueCard}>
      <View style={s.issueHead}>
        <Text style={s.issueTitle}>{displayName}</Text>
        {editable ? (
          <Pressable onPress={onRemove} hitSlop={8}>
            <MaterialCommunityIcons name="close" size={18} color={COLORS.textMuted} />
          </Pressable>
        ) : null}
      </View>
      <View style={{ height: 8 }} />
      <View style={s.issueCountRow}>
        <Text style={s.issueCountLabel}>Bunches affected</Text>
        {editable ? (
          <TextInput
            value={bunches}
            onChangeText={onBunchesChange}
            keyboardType="number-pad"
            style={s.issueCountInput}
          />
        ) : (
          <View style={s.chip}>
            <Text style={s.chipText}>{Number.parseInt(bunches, 10) || 0}</Text>
          </View>
        )}
      </View>
      <View style={s.toleranceChipWrap}>
        <View style={[s.chip, { alignSelf: 'flex-start' }]}>
          <MaterialCommunityIcons name="scale-balance" size={14} color={COLORS.textMuted} />
          <Text style={s.chipText}>
            {thresholdPercent <= 0 ? 'Zero tolerance' : `Tolerance ${thresholdPercent}%`}
          </Text>
        </View>
      </View>
    </View>
  );
}

function IssueRowCard({
  issue,
  displayName,
  onRemove,
  showAction = true,
  countLabel,
  onCountChange,
  toleranceInfo,
  tolerance,
}: {
  issue: IssueRow;
  displayName: string;
  onRemove: () => void;
  showAction?: boolean;
  /** When provided (with onCountChange), the count renders as an editable
   *  field instead of a static chip — used in the working "Add Issue" list,
   *  not the read-only Review summary. */
  countLabel?: string;
  onCountChange?: (count: number) => void;
  /** The parameter's tolerance threshold (%) plus this issue's affected share
   *  of the total checked — shown as a compare-to-tolerance badge on the row
   *  when the full sample-based line below isn't available (outside Final QC).
   *  `affectedPercent` is null when the checked total isn't known yet. */
  toleranceInfo?: {
    thresholdPercent: number;
    affectedPercent: number | null;
    breached: boolean;
  };
  /** Final QC only — the parameter's tolerance and this issue's affected
   *  bunches, so the row can show whether it quarantines the order (breach)
   *  or is a partial reject (within tolerance). */
  tolerance?: {
    thresholdPercent: number;
    affectedBunches: number;
    sampled: number;
    breached: boolean;
  };
}) {
  const editable = !!onCountChange;
  return (
    <View style={s.issueCard}>
      <View style={s.issueHead}>
        <Text style={s.issueTitle}>{displayName}</Text>
        <Pressable onPress={onRemove} hitSlop={8}>
          <MaterialCommunityIcons name="close" size={18} color={COLORS.textMuted} />
        </Pressable>
      </View>
      <View style={{ height: 8 }} />
      {editable ? (
        <View style={s.issueCountRow}>
          <Text style={s.issueCountLabel}>{countLabel ?? 'Affected'}</Text>
          <TextInput
            value={String(issue.count)}
            onChangeText={(v) => onCountChange?.(Number.parseInt(v, 10) || 0)}
            keyboardType="number-pad"
            style={s.issueCountInput}
          />
        </View>
      ) : (
        <View style={s.chipRow}>
          <View style={s.chip}>
            <Text style={s.chipText}>{issue.count} affected</Text>
          </View>
          {showAction ? (
            <View style={[s.chip, issue.action === 'Reject' ? s.chipDanger : s.chipWarn]}>
              <Text style={s.chipText}>{issue.action}</Text>
            </View>
          ) : null}
        </View>
      )}
      {tolerance ? (
        <ToleranceLine {...tolerance} />
      ) : toleranceInfo ? (
        <IssueToleranceBadge {...toleranceInfo} />
      ) : null}
    </View>
  );
}

/** Compares an issue's affected share against its parameter's tolerance
 *  threshold (from the QC Parameters list) and flags whether it exceeds it.
 *  Display only — the operator still decides the final result. When the
 *  checked total isn't known yet we show just the threshold, no verdict. */
function IssueToleranceBadge({
  thresholdPercent,
  affectedPercent,
  breached,
}: {
  thresholdPercent: number;
  affectedPercent: number | null;
  breached: boolean;
}) {
  const toleranceText = thresholdPercent <= 0 ? 'Zero tolerance' : `Tolerance ${thresholdPercent}%`;
  if (affectedPercent === null) {
    return (
      <View style={s.toleranceChipWrap}>
        <View style={[s.chip, { alignSelf: 'flex-start' }]}>
          <MaterialCommunityIcons name="scale-balance" size={14} color={COLORS.textMuted} />
          <Text style={s.chipText}>{toleranceText}</Text>
        </View>
      </View>
    );
  }
  return (
    <View style={s.toleranceChipWrap}>
      <Text style={s.muted}>
        {toleranceText} · {affectedPercent.toFixed(1)}% affected
      </Text>
      <View style={{ height: 6 }} />
      <View style={[s.chip, breached ? s.chipDanger : s.chipAccepted, { alignSelf: 'flex-start' }]}>
        <MaterialCommunityIcons
          name={breached ? 'alert-circle' : 'check-circle'}
          size={14}
          color={breached ? COLORS.danger : COLORS.success}
        />
        <Text style={[s.chipText, { color: breached ? COLORS.danger : COLORS.success }]}>
          {breached ? 'Exceeds tolerance' : 'Within tolerance'}
        </Text>
      </View>
    </View>
  );
}

/** Shows a parameter's tolerance and whether this issue breaches it —
 *  breach quarantines the whole order; within tolerance is a partial reject
 *  of just the affected bunches. */
function ToleranceLine({
  thresholdPercent,
  affectedBunches,
  sampled,
  breached,
}: {
  thresholdPercent: number;
  affectedBunches: number;
  sampled: number;
  breached: boolean;
}) {
  const toleranceText =
    thresholdPercent <= 0 ? 'Zero tolerance' : `Tolerance ${thresholdPercent}%`;
  const affectedText =
    sampled > 0 ? `${affectedPercent(affectedBunches, sampled).toFixed(1)}% of ${sampled} sampled` : 'sample size unknown';
  return (
    <View style={{ marginTop: 8 }}>
      <Text style={s.muted}>
        {toleranceText} · {affectedText}
      </Text>
      <View style={{ height: 6 }} />
      <View style={[s.chip, breached ? s.chipDanger : s.chipAccepted, { alignSelf: 'flex-start' }]}>
        <MaterialCommunityIcons
          name={breached ? 'alert-circle' : 'content-cut'}
          size={14}
          color={breached ? COLORS.danger : COLORS.success}
        />
        <Text style={[s.chipText, { color: breached ? COLORS.danger : COLORS.success }]}>
          {breached ? 'Exceeds tolerance' : `Within tolerance — reject ${affectedBunches} bunch(es)`}
        </Text>
      </View>
    </View>
  );
}

function ResultBadge({ result }: { result: PackhouseOverallResult }) {
  const tone =
    result === 'Rejected' ? s.badgeDanger : result === 'Quarantined' ? s.badgeWarn : s.badgeOk;
  return (
    <Card>
      <Text style={s.section}>COMPUTED RESULT</Text>
      <View style={{ height: 8 }} />
      <View style={[s.badge, tone]}>
        <Text style={s.badgeText}>{result}</Text>
      </View>
    </Card>
  );
}

type PickerOption = {
  label: string;
  value: string;
  subtitle?: string;
  /** Show a green tick on the row — e.g. a spec that has orders to QC. */
  hasOrders?: boolean;
  /** Optional count shown next to the tick. */
  orderCount?: number;
  /** When set on any option, the list renders labelled sections in the order
   *  the groups first appear (e.g. QC parameter categories). */
  group?: string;
};

/** Groups options into sections, preserving the order each group first appears
 *  in — callers pass options already sorted into the desired category order. */
function toPickerSections(items: PickerOption[]): { title: string; data: PickerOption[] }[] {
  const sections: { title: string; data: PickerOption[] }[] = [];
  const byTitle = new Map<string, { title: string; data: PickerOption[] }>();
  for (const item of items) {
    const title = item.group ?? '';
    let section = byTitle.get(title);
    if (!section) {
      section = { title, data: [] };
      byTitle.set(title, section);
      sections.push(section);
    }
    section.data.push(item);
  }
  return sections;
}

function PickerModal({
  open,
  title,
  onClose,
  options,
  onPick,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  options: PickerOption[];
  onPick: (value: string) => void;
}) {
  const [search, setSearch] = useState('');
  const filtered = search
    ? options.filter((o) => `${o.label} ${o.subtitle ?? ''}`.toLowerCase().includes(search.toLowerCase()))
    : options;
  const grouped = filtered.some((o) => o.group);

  const renderRow = ({ item }: { item: PickerOption }) => (
    <Pressable onPress={() => onPick(item.value)} style={s.modalRow}>
      <View style={s.modalRowMain}>
        <Text style={s.modalRowText}>{item.label}</Text>
        {item.subtitle ? <Text style={s.modalRowSubtitle}>{item.subtitle}</Text> : null}
      </View>
      {item.hasOrders ? (
        <View style={s.modalRowBadge}>
          <MaterialCommunityIcons name="check-circle" size={18} color={COLORS.success} />
          {item.orderCount ? (
            <Text style={s.modalRowBadgeText}>
              {item.orderCount} {item.orderCount === 1 ? 'order' : 'orders'}
            </Text>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );

  return (
    <Modal visible={open} animationType="slide" onRequestClose={onClose}>
      <View style={s.modalRoot}>
        <View style={s.modalHeader}>
          <Text style={s.modalTitle}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={s.modalClose}>Cancel</Text>
          </Pressable>
        </View>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search…"
          placeholderTextColor={COLORS.textMuted}
          autoCapitalize="none"
          style={s.modalSearch}
        />
        {grouped ? (
          <SectionList
            sections={toPickerSections(filtered)}
            keyExtractor={(item) => item.value}
            ItemSeparatorComponent={() => <View style={s.modalSep} />}
            keyboardShouldPersistTaps="handled"
            stickySectionHeadersEnabled
            renderSectionHeader={({ section }) =>
              section.title ? (
                <View style={s.modalSectionHeader}>
                  <Text style={s.modalSectionHeaderText}>{section.title}</Text>
                </View>
              ) : null
            }
            renderItem={renderRow}
            ListEmptyComponent={<Text style={s.modalEmpty}>No matches.</Text>}
          />
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.value}
            ItemSeparatorComponent={() => <View style={s.modalSep} />}
            keyboardShouldPersistTaps="handled"
            renderItem={renderRow}
            ListEmptyComponent={<Text style={s.modalEmpty}>No matches.</Text>}
          />
        )}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  landingHeader: { marginBottom: spacing.lg },
  landingTitle: { fontFamily: fontFamily.bold, fontSize: fontSize.xl, color: COLORS.text },
  landingSubtitle: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: COLORS.textMuted, marginTop: 4 },
  workflowTile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: COLORS.surface,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  workflowTilePressed: { opacity: 0.7 },
  workflowIconWrap: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.md,
    backgroundColor: COLORS.bgMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  workflowTextWrap: { flex: 1 },
  workflowLabel: { fontFamily: fontFamily.semiBold, fontSize: fontSize.md, color: COLORS.text },
  workflowDescription: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: COLORS.textMuted, marginTop: 2 },
  activeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: COLORS.surface,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.lg,
  },
  activeHeaderIconWrap: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.sm,
    backgroundColor: COLORS.bgMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeHeaderLabel: { flex: 1, fontFamily: fontFamily.semiBold, fontSize: fontSize.md, color: COLORS.text },
  changeLink: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: COLORS.textMuted, textDecorationLine: 'underline' },
  sectionLabelWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm, marginBottom: spacing.md },
  sectionLabelRule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: COLORS.border },
  sectionLabelText: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.xs,
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  muted: { fontSize: 12, color: COLORS.textMuted, marginTop: 4 },
  hint: { fontSize: 12, color: COLORS.textMuted },
  warn: { fontSize: 13, fontWeight: '600', color: COLORS.text },
  section: {
    fontWeight: '700',
    color: COLORS.textMuted,
    fontSize: 12,
    letterSpacing: 0.4,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: COLORS.bgMuted,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 12,
  },
  pickerText: { flex: 1, color: COLORS.text, fontWeight: '600' },
  chipRow: { flexDirection: 'row', gap: 12, marginTop: 12, marginBottom: 4, flexWrap: 'wrap' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: COLORS.bgMuted,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chipWarn: { backgroundColor: '#FFFBEB', borderColor: '#B45309' },
  chipDanger: { backgroundColor: '#FEF2F2', borderColor: COLORS.danger },
  chipText: { fontSize: 13, fontWeight: '600', color: COLORS.text },
  empty: {
    color: COLORS.textMuted,
    textAlign: 'center',
    paddingVertical: 16,
    fontSize: 13,
  },
  actionRow: { flexDirection: 'row', gap: 12 },
  issueCard: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    backgroundColor: COLORS.bg,
  },
  issueHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  issueTitle: { fontSize: 14, fontWeight: '600', color: COLORS.text },
  specCheckRow: { paddingVertical: 4 },
  specCheckHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  chipAccepted: { backgroundColor: '#F0FDF4', borderColor: COLORS.success },
  specCheckInput: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    fontSize: 13,
    color: COLORS.text,
    backgroundColor: COLORS.bg,
  },
  specCheckAffectedRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  specCheckAffectedLabel: { fontSize: 13, color: COLORS.text, flex: 1 },
  specCheckAffectedInput: {
    width: 72,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    fontSize: 13,
    color: COLORS.text,
    backgroundColor: COLORS.bg,
    textAlign: 'center',
  },
  specCheckAffectedHintRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  specCheckAffectedHint: { fontSize: 12, color: COLORS.danger, flex: 1 },
  toleranceChipWrap: { marginTop: 8 },
  issueCountRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  issueCountLabel: { fontSize: 12, color: COLORS.textMuted, flex: 1 },
  issueCountInput: {
    width: 64,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    fontSize: 14,
    color: COLORS.text,
    textAlign: 'center',
    backgroundColor: COLORS.bg,
  },
  remarksInput: {
    minHeight: 80,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    color: COLORS.text,
    backgroundColor: COLORS.bg,
    textAlignVertical: 'top',
  },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  badgeText: { fontWeight: '700', color: '#fff' },
  badgeOk: { backgroundColor: COLORS.success },
  badgeWarn: { backgroundColor: '#B45309' },
  badgeDanger: { backgroundColor: COLORS.danger },
  modalRoot: { flex: 1, backgroundColor: COLORS.bg },
  modalHeader: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: COLORS.text,
  },
  modalTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text },
  modalClose: { fontSize: 14, color: COLORS.text, fontWeight: '600' },
  modalSearch: {
    margin: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 15,
    color: COLORS.text,
  },
  modalRow: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  modalRowMain: { flex: 1 },
  modalSep: { height: StyleSheet.hairlineWidth, backgroundColor: COLORS.border },
  modalRowText: { fontSize: 15, color: COLORS.text },
  modalRowSubtitle: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  modalRowBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  modalRowBadgeText: { fontSize: 12, fontWeight: '700', color: COLORS.success },
  modalSectionHeader: {
    backgroundColor: COLORS.bgMuted,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
  },
  modalSectionHeaderText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  modalEmpty: { padding: 16, color: COLORS.textMuted },
});
