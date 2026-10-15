import React from 'react';
import { Grid, GridItem, Stack, Heading, Text, Button, Image } from '../ui';

const SelectionCards = ({ cards, imgType }) => {
    return (
        <Grid
            gridTemplateColumns="repeat(auto-fill, minmax(280px, 1fr))"
            gap="base"
        >
            {cards.map((card, i) => (
                <GridItem
                    key={i}
                    border="base"
                    borderColor="base"
                    borderStyle="solid"
                    borderWidth="small"
                    borderRadius="base"
                    background="base"
                    overflow="hidden"
                    blockSize="100%"
                    display="flex"
                >
                    <Stack gap="none" blockSize="100%" justifyContent="space-between">
                        <Stack gap="none">
                            {card.img && (
                                (card.imgType === 'contain' || imgType === 'contain') ? (
                                    <Stack
                                        background="subdued"
                                        padding="large"
                                        alignItems="center"
                                        justifyContent="center"
                                        minBlockSize="140px"
                                        maxBlockSize="140px"
                                    >
                                        <Image
                                            src={card.img}
                                            alt={card.label || card.title}
                                            inlineSize="auto"
                                            aspectRatio="16/9"
                                            objectFit="contain"
                                        />
                                    </Stack>
                                ) : (
                                    <Image
                                        src={card.img}
                                        alt={card.label || card.title}
                                        inlineSize="fill"
                                        aspectRatio="4/3"
                                        objectFit="cover"
                                    />
                                )
                            )}
                            <Stack gap="small-400" padding="base">
                                <Heading level="h4">{card.label || card.title}</Heading>
                                <Text color="subdued">{card.desc || card.description}</Text>
                            </Stack>
                        </Stack>
                        <Stack padding="base">
                            <Button
                                variant="secondary"
                                disabled={card.disabled}
                                onClick={card.onClick}
                            >
                                {card.buttonText || "Create Rule"}
                            </Button>
                        </Stack>
                    </Stack>
                </GridItem>
            ))}
        </Grid>
    );
};

export default React.memo(SelectionCards);
