import React from "react";

import { Grid, GridItem, Page, QueryContainer } from "../../ui";
import "./Skeleton.css";

export const SkeletonBodyText = ({ lines = 3, height = "16px", width = "100%" }) => {
    return (
        <div className="skeleton-stack" style={{ width }}>
            {[...Array(lines)].map((_, index) => (
                <div
                    key={index}
                    className="skeleton-line"
                    style={{ height, width }}
                />
            ))}
        </div>
    );
};

export const SkeletonLine = ({ width = "100%", height = "14px" }) => {
    return (
        <div
            className="skeleton-line"
            style={{ width, height }}
        />
    );
}

const SkeletonPage = () => {
    return (
        <Page>
            <QueryContainer>
                <Grid
                    paddingBlockStart={'small'}
                    gap="base"
                    gridTemplateColumns={`@container (inline-size < 500px) 'repeat(1, 1fr)', 'repeat(12,1fr)'`}
                    columnGap="@container (inline-size < 500px) 'none', 'base'"
                    rowGap="@container (inline-size < 500px) 'base', 'none'"
                >
                    <GridItem gridColumn='span 8'>
                        <SkeletonBodyText lines={1} height="700px" />
                    </GridItem>
                    <GridItem gridColumn='span 4'>
                        <SkeletonBodyText lines={1} height="700px" />
                    </GridItem>
                </Grid>
            </QueryContainer>
        </Page>
    );
};

export default React.memo(SkeletonPage);
