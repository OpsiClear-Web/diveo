import React, {
  useEffect,
  useState,
  useRef,
  useMemo,
  useCallback,
} from "react";
import {
  View,
  StyleSheet,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
  Image,
  RefreshControl,
  ViewToken,
  FlatList,
  ScrollView,
  type ImageStyle,
} from "react-native";
import PagerView from "react-native-pager-view";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { VideoCard } from "../components/VideoCard";
import { LiveCard } from "../components/LiveCard";
import { LoginModal } from "../components/LoginModal";
import { DownloadProgressBtn } from "../components/DownloadProgressBtn";
import { useVideoList } from "../hooks/useVideoList";
import { useLiveList } from "../hooks/useLiveList";
import { useAuthStore } from "../store/authStore";
import {
  toListRows,
  type ListRow,
  type BigRow,
} from "../utils/videoRows";
import { BigVideoCard } from "../components/BigVideoCard";
import { FollowedLiveStrip } from "../components/FollowedLiveStrip";
import { type ThemeColors, useTheme } from "../utils/theme";
import { GSAV_ACCENT, GSAV_ACCENT_TINT } from "../utils/gsavBridge";
import { useVisibleBigKeyStore } from "../store/visibleBigKeyStore";
import type { LiveRoom } from "../services/types";

const HEADER_H = 44;
const TAB_H = 38;
const NAV_H = HEADER_H + TAB_H;

const VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 50 };

type TabKey = "hot" | "live";

const TABS: { key: TabKey; label: string }[] = [
  { key: "hot", label: "热门" },
  { key: "live", label: "直播" },
];

const LIVE_AREAS = [
  { id: 0, name: "推荐" },
  { id: 2, name: "网游" },
  { id: 3, name: "手游" },
  { id: 6, name: "单机游戏" },
  { id: 1, name: "娱乐" },
  { id: 9, name: "虚拟主播" },
  { id: 10, name: "生活" },
  { id: 11, name: "知识" },
];

function GsavHomeEntry({
  theme,
  onOpen,
  onDiagnostics,
}: {
  theme: ThemeColors;
  onOpen: () => void;
  onDiagnostics: () => void;
}) {
  return (
    <View style={[styles.gsavEntry, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <View style={styles.gsavMark}>
        <Ionicons name="cube-outline" size={18} color={GSAV_ACCENT} />
      </View>
      <View style={styles.gsavCopy}>
        <Text numberOfLines={1} style={[styles.gsavTitle, { color: theme.text }]}>Diveo</Text>
        <Text numberOfLines={1} style={[styles.gsavSubtitle, { color: theme.textSub }]}>4D Gaussian video</Text>
      </View>
      <TouchableOpacity
        style={styles.gsavIconButton}
        onPress={onOpen}
        activeOpacity={0.75}
        accessibilityLabel="Open Diveo test scene"
      >
        <Ionicons name="play" size={16} color="#fff" />
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.gsavIconButton, styles.gsavSecondaryButton]}
        onPress={onDiagnostics}
        activeOpacity={0.75}
        accessibilityLabel="Open Diveo diagnostics"
      >
        <Ionicons name="pulse-outline" size={16} color={GSAV_ACCENT} />
      </TouchableOpacity>
    </View>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const { pages, loading, refreshing, load, refresh } = useVideoList();
  const {
    rooms,
    loading: liveLoading,
    refreshing: liveRefreshing,
    load: liveLoad,
    refresh: liveRefresh,
  } = useLiveList();
  const { isLoggedIn, face } = useAuthStore();
  const [showLogin, setShowLogin] = useState(false);
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<TabKey>("hot");
  const [liveAreaId, setLiveAreaId] = useState(0);

  const theme = useTheme();
  const rows = useMemo(() => toListRows(pages), [pages]);
  const pagerRef = useRef<PagerView>(null);

  const hotListRef = useRef<FlatList>(null);
  const liveListRef = useRef<FlatList>(null);

  const openGsavTest = useCallback(() => {
    router.push("/watch/test" as any);
  }, [router]);

  const openGsavDiagnostics = useCallback(() => {
    router.push("/gsav-diagnostics" as any);
  }, [router]);

  const onViewableItemsChangedRef = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const bigRow = viewableItems.find(
        (v) => v.item && (v.item as ListRow).type === "big",
      );
      useVisibleBigKeyStore.getState().setKey(bigRow ? (bigRow.item as BigRow).item.bvid : null);
    },
  ).current;

  // 滚动累计阈值：方向反转后需累计滚动该距离才触发显隐切换
  const SCROLL_THRESHOLD = 40;
  // 显隐过渡时长
  const HEADER_ANIM_MS = 100;

  const headerOffset = useRef(new Animated.Value(0)).current; // 0 = 显示，HEADER_H = 隐藏
  const liveHeaderOffset = useRef(new Animated.Value(0)).current;

  const headerTranslate = headerOffset.interpolate({
    inputRange: [0, HEADER_H],
    outputRange: [0, -HEADER_H],
    extrapolate: "clamp",
  });
  const headerOpacity = headerOffset.interpolate({
    inputRange: [0, HEADER_H * 0.6, HEADER_H],
    outputRange: [1, 1, 0],
    extrapolate: "clamp",
  });

  const liveHeaderTranslate = liveHeaderOffset.interpolate({
    inputRange: [0, HEADER_H],
    outputRange: [0, -HEADER_H],
    extrapolate: "clamp",
  });
  const liveHeaderOpacity = liveHeaderOffset.interpolate({
    inputRange: [0, HEADER_H * 0.6, HEADER_H],
    outputRange: [1, 1, 0],
    extrapolate: "clamp",
  });

  const hotScrollState = useRef({ lastY: 0, acc: 0, dir: 0, hidden: false }).current;
  const liveScrollState = useRef({ lastY: 0, acc: 0, dir: 0, hidden: false }).current;

  const animateHeader = useCallback(
    (offset: Animated.Value, hide: boolean) => {
      Animated.timing(offset, {
        toValue: hide ? HEADER_H : 0,
        duration: HEADER_ANIM_MS,
        useNativeDriver: true,
      }).start();
    },
    [],
  );

  const updateHeaderForScroll = useCallback(
    (
      y: number,
      state: { lastY: number; acc: number; dir: number; hidden: boolean },
      offset: Animated.Value,
    ) => {
      // 顶部强制显示
      if (y <= 0) {
        if (state.hidden) {
          state.hidden = false;
          animateHeader(offset, false);
        }
        state.lastY = 0;
        state.acc = 0;
        state.dir = 0;
        return;
      }
      const dy = y - state.lastY;
      state.lastY = y;
      if (Math.abs(dy) < 1) return;
      const dir = dy > 0 ? 1 : -1; // 1=向下滚（隐藏），-1=向上滚（显示）
      if (dir !== state.dir) {
        state.dir = dir;
        state.acc = 0;
      }
      state.acc += Math.abs(dy);
      if (state.acc < SCROLL_THRESHOLD) return;
      const shouldHide = dir === 1;
      if (shouldHide !== state.hidden) {
        state.hidden = shouldHide;
        animateHeader(offset, shouldHide);
      }
      state.acc = 0;
    },
    [animateHeader],
  );

  useEffect(() => {
    load();
  }, []);

  const onScroll = useCallback(
    (e: any) =>
      updateHeaderForScroll(
        e.nativeEvent.contentOffset.y,
        hotScrollState,
        headerOffset,
      ),
    [updateHeaderForScroll],
  );

  const onLiveScroll = useCallback(
    (e: any) =>
      updateHeaderForScroll(
        e.nativeEvent.contentOffset.y,
        liveScrollState,
        liveHeaderOffset,
      ),
    [updateHeaderForScroll],
  );

  const handleTabPress = useCallback(
    (key: TabKey) => {
      if (key === activeTab) {
        // 点击已激活的 tab：滚动到顶部并刷新
        if (key === "hot") {
          hotListRef.current?.scrollToOffset({ offset: 0, animated: true });
          refresh();
        } else {
          liveListRef.current?.scrollToOffset({ offset: 0, animated: true });
          liveRefresh(liveAreaId);
        }
        return;
      }
      // 切换 tab
      pagerRef.current?.setPage(key === "hot" ? 0 : 1);
      setActiveTab(key);
      if (key === "live" && rooms.length === 0) {
        liveLoad(true, liveAreaId);
      }
    },
    [activeTab, rooms.length, liveAreaId],
  );

  const onPageSelected = useCallback(
    (e: any) => {
      const key: TabKey = e.nativeEvent.position === 0 ? "hot" : "live";
      if (key === activeTab) return;
      setActiveTab(key);
      if (key === "live" && rooms.length === 0) {
        liveLoad(true, liveAreaId);
      }
    },
    [activeTab, rooms.length, liveAreaId],
  );

  const handleLiveAreaPress = useCallback(
    (areaId: number) => {
      if (areaId === liveAreaId) return;
      setLiveAreaId(areaId);
      liveListRef.current?.scrollToOffset({ offset: 0, animated: false });
      liveLoad(true, areaId);
    },
    [liveAreaId, liveLoad],
  );

  const renderItem = useCallback(({ item: row }: { item: ListRow }) => {
    if (row.type === "big") {
      return (
        <BigVideoCard
          item={row.item}
          onPress={() => router.push(`/video/${row.item.bvid}` as any)}
        />
      );
    }
    const right = row.right;
    return (
      <View style={styles.row}>
        <View style={styles.leftCol}>
          <VideoCard
            item={row.left}
            onPress={() => router.push(`/video/${row.left.bvid}` as any)}
          />
        </View>
        {right && (
          <View style={styles.rightCol}>
            <VideoCard
              item={right}
              onPress={() => router.push(`/video/${right.bvid}` as any)}
            />
          </View>
        )}
      </View>
    );
  }, []);

  const renderLiveItem = useCallback(
    ({ item }: { item: { left: LiveRoom; right?: LiveRoom } }) => (
      <View style={styles.row}>
        <View style={styles.leftCol}>
          <LiveCard
            item={item.left}
            onPress={() => router.push(`/live/${item.left.roomid}` as any)}
          />
        </View>
        {item.right && (
          <View style={styles.rightCol}>
            <LiveCard
              item={item.right}
              onPress={() => router.push(`/live/${item.right!.roomid}` as any)}
            />
          </View>
        )}
      </View>
    ),
    [],
  );

  // 将直播列表分成两列的行
  const liveRows = useMemo(() => {
    const result: { left: LiveRoom; right?: LiveRoom }[] = [];
    for (let i = 0; i < rooms.length; i += 2) {
      result.push({ left: rooms[i], right: rooms[i + 1] });
    }
    return result;
  }, [rooms]);

  const currentHeaderTranslate =
    activeTab === "hot" ? headerTranslate : liveHeaderTranslate;
  const currentHeaderOpacity =
    activeTab === "hot" ? headerOpacity : liveHeaderOpacity;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]} edges={["left", "right"]}>
      {/* 滑动切换容器 */}
      <PagerView
        ref={pagerRef}
        style={styles.pager}
        initialPage={0}
        scrollEnabled={false}
        onPageSelected={onPageSelected}
      >
        {/* 热门列表 */}
        <View key="hot" collapsable={false}>
          <Animated.FlatList
            ref={hotListRef as any}
            style={styles.listContainer}
            data={rows}
            keyExtractor={(row: any) =>
              row.type === "big"
                ? `big-${row.item.bvid}`
                : `pair-${row.left.bvid}-${row.right?.bvid ?? "empty"}`
            }
            contentContainerStyle={{
              paddingTop: insets.top + NAV_H + 6,
              paddingBottom: insets.bottom + 16,
            }}
            renderItem={renderItem}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={refresh}
                progressViewOffset={insets.top + NAV_H}
              />
            }
            onEndReached={() => load()}
            onEndReachedThreshold={0.5}
            viewabilityConfig={VIEWABILITY_CONFIG}
            onViewableItemsChanged={onViewableItemsChangedRef}
            ListHeaderComponent={
              <GsavHomeEntry
                theme={theme}
                onOpen={openGsavTest}
                onDiagnostics={openGsavDiagnostics}
              />
            }
            ListFooterComponent={
              <View style={styles.footer}>
                {loading && <ActivityIndicator color="#00AEEC" />}
              </View>
            }
            onScroll={onScroll}
            scrollEventThrottle={16}
            windowSize={7}
            maxToRenderPerBatch={6}
            removeClippedSubviews={true}
          />
        </View>

        {/* 直播列表 */}
        <View key="live" collapsable={false}>
          <Animated.FlatList
            ref={liveListRef as any}
            style={styles.listContainer}
            data={liveRows}
            keyExtractor={(item: any, index: number) =>
              `live-${index}-${item.left.roomid}-${item.right?.roomid ?? "empty"}`
            }
            contentContainerStyle={{
              paddingTop: insets.top + NAV_H + 6,
              paddingBottom: insets.bottom + 16,
            }}
            renderItem={renderLiveItem}
            ListHeaderComponent={
              <View>
                <FollowedLiveStrip />
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.areaTabRow}
                  contentContainerStyle={styles.areaTabContent}
                >
                  {LIVE_AREAS.map((area) => (
                    <TouchableOpacity
                      key={area.id}
                      style={[
                        styles.areaTab,
                        liveAreaId === area.id && styles.areaTabActive,
                      ]}
                      onPress={() => handleLiveAreaPress(area.id)}
                      activeOpacity={0.7}
                    >
                      <Text
                        style={[
                          styles.areaTabText,
                          liveAreaId === area.id && styles.areaTabTextActive,
                        ]}
                      >
                        {area.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            }
            refreshControl={
              <RefreshControl
                refreshing={liveRefreshing}
                onRefresh={() => liveRefresh(liveAreaId)}
                progressViewOffset={insets.top + NAV_H}
              />
            }
            onEndReached={() => liveLoad()}
            onEndReachedThreshold={1.5}
            ListFooterComponent={
              liveLoading ? (
                <View style={styles.footer}>
                  <ActivityIndicator color="#00AEEC" />
                  <Text style={styles.footerText}>加载中...</Text>
                </View>
              ) : null
            }
            onScroll={onLiveScroll}
            scrollEventThrottle={16}
            windowSize={7}
            maxToRenderPerBatch={6}
            removeClippedSubviews={true}
          />
        </View>
      </PagerView>

      {/* 绝对定位导航栏 */}
      <Animated.View
        style={[
          styles.navBar,
          {
            paddingTop: insets.top,
            backgroundColor: theme.card,
            transform: [{ translateY: currentHeaderTranslate }],
          },
        ]}
      >
        <Animated.View
          style={[
            styles.header,
            {
              opacity: currentHeaderOpacity,
            },
          ]}
        >
          <View style={styles.headerRight}>
            <TouchableOpacity
              style={styles.headerBtn}
              onPress={() => (isLoggedIn ? router.push('/settings' as any) : setShowLogin(true))}
            >
              {isLoggedIn && face ? (
                <Image source={{ uri: face }} style={styles.userAvatar as ImageStyle} />
              ) : (
                <Ionicons
                  name={isLoggedIn ? "person" : "person-outline"}
                  size={22}
                  color="#00AEEC"
                />
              )}
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={[styles.searchBar, { backgroundColor: theme.inputBg }]}
            onPress={() => router.push("/search" as any)}
            activeOpacity={0.7}
          >
            <Ionicons name="search" size={14} color={theme.textSub} />
            <Text style={[styles.searchPlaceholder, { color: theme.textSub }]}>搜索视频、UP主...</Text>
          </TouchableOpacity>
          <DownloadProgressBtn
            onPress={() => router.push("/downloads" as any)}
          />
        </Animated.View>

        <View style={[styles.tabRow, { backgroundColor: theme.card }]}>
          {TABS.map((tab) => (
            <TouchableOpacity
              key={tab.key}
              style={styles.tabItem}
              onPress={() => handleTabPress(tab.key)}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.tabText,
                  { color: theme.textSub },
                  activeTab === tab.key && styles.tabTextActive,
                ]}
              >
                {tab.label}
              </Text>
              {activeTab === tab.key && <View style={styles.tabUnderline} />}
            </TouchableOpacity>
          ))}
        </View>
      </Animated.View>

      <LoginModal visible={showLogin} onClose={() => setShowLogin(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f4f4f4" },
  pager: { flex: 1 },
  listContainer: { flex: 1 },
  navBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    backgroundColor: "#fff",
    overflow: "hidden",
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
  },
  header: {
    height: HEADER_H,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    gap: 10,
  },
  logo: {
    fontSize: 20,
    fontWeight: "800",
    color: "#00AEEC",
    letterSpacing: -0.5,
    width: 72,
  },
  searchBar: {
    flex: 1,
    height: 30,
    marginLeft: 8,
    backgroundColor: "#f0f0f0",
    borderRadius: 15,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    gap: 5,
  },
  downloadBtn: {},
  searchPlaceholder: {
    fontSize: 13,
    color: "#999",
    flex: 1,
  },
  headerRight: { flexDirection: "row", gap: 8, alignItems: "center" },
  headerBtn: { paddingLeft: 0 },
  userAvatar: {
    width: 35,
    height: 35,
    borderRadius: 50,
    backgroundColor: "#eee",
  },
  tabRow: {
    height: TAB_H,
    backgroundColor: "#fff",
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 20,
  },
  tabItem: {
    alignItems: "center",
    justifyContent: "center",
    height: TAB_H,
  },
  tabText: {
    fontSize: 15,
    fontWeight: "400",
    color: "#999",
  },
  tabTextActive: {
    fontWeight: "500",
    color: "#00AEEC",
  },
  tabUnderline: {
    position: "absolute",
    bottom: 4,
    width: 24,
    height: 3,
    backgroundColor: "#00AEEC",
    borderRadius: 4,
  },
  row: {
    flexDirection: "row",
    paddingHorizontal: 1,
    justifyContent: "flex-start",
  },
  leftCol: { marginLeft: 4, marginRight: 2 },
  rightCol: { marginLeft: 2, marginRight: 4 },
  footer: {
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  footerText: { fontSize: 12, color: "#999" },
  areaTabRow: {
    marginBottom: 6,
  },
  areaTabContent: {
    paddingHorizontal: 8,
    gap: 8,
    alignItems: "center",
    height: 36,
  },
  areaTab: {
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: 16,
  },
  areaTabActive: {
    backgroundColor: "#00AEEC",
  },
  areaTabText: {
    fontSize: 13,
    color: "#333",
    fontWeight: "500",
  },
  areaTabTextActive: {
    color: "#fff",
    fontWeight: "600",
  },
  gsavEntry: {
    minHeight: 56,
    marginHorizontal: 8,
    marginBottom: 8,
    paddingHorizontal: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  gsavMark: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GSAV_ACCENT_TINT,
  },
  gsavCopy: {
    flex: 1,
    minWidth: 0,
  },
  gsavTitle: {
    fontSize: 14,
    fontWeight: "800",
  },
  gsavSubtitle: {
    marginTop: 2,
    fontSize: 11,
  },
  gsavIconButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GSAV_ACCENT,
  },
  gsavSecondaryButton: {
    backgroundColor: GSAV_ACCENT_TINT,
  },
});
