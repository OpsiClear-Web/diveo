import React from "react";
import { View, Text, StyleSheet } from "react-native";
import Svg, { Path } from "react-native-svg";

import { space } from "../theme";

// Shared diVeo brand lockup matching the gsav-hosting web header.
export function Brand({
  logoSize = 26,
  fontSize = 20,
  color = "#212121",
}: {
  logoSize?: number;
  fontSize?: number;
  color?: string;
}) {
  return (
    <View style={styles.row}>
      <Svg width={logoSize} height={logoSize} viewBox="1717 1574 808 807">
        <Path
          d="M1933.38 2314.6 1735.45 1971.78C1698.98 1908.61 1720.62 1827.84 1783.79 1791.36L1898.17 1725.33 2228.17 2296.9 2113.79 2362.94C2050.62 2399.41 1969.85 2377.77 1933.38 2314.6Z"
          fill={color}
          fillRule="evenodd"
        />
        <Path
          d="M2047.76 2248.56 1849.83 1905.74C1813.36 1842.57 1835 1761.8 1898.17 1725.33L2012.56 1659.29 2342.56 2230.87 2228.17 2296.9C2165 2333.38 2084.23 2311.73 2047.76 2248.56Z"
          fill="#FF7C80"
          fillRule="evenodd"
        />
        <Path
          d="M2310.12 1641.43 2506.8 1982.1C2543.62 2045.86 2521.77 2127.4 2458.01 2164.21L2346.41 2228.64C2344.28 2229.87 2341.56 2229.14 2340.33 2227.01L2014.78 1663.14C2013.55 1661.01 2014.28 1658.29 2016.41 1657.06L2128.01 1592.63C2191.77 1555.82 2273.3 1577.67 2310.12 1641.43Z"
          fill="#FFCC66"
          fillRule="evenodd"
        />
        <Path
          d="M2152.32 2140.6 1996.55 1871.05 2307.1 1849.15Z"
          fill="#FFFFFF"
          fillRule="evenodd"
        />
      </Svg>
      <Text style={[styles.wordmark, { color, fontSize }]}>diVeo</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.sm + 1 },
  wordmark: { fontFamily: "Roboto_900Black", letterSpacing: 0 },
});
