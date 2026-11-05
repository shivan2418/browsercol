package browsercol.web;

import java.util.Map;

import net.sf.freecol.common.networking.*;


/**
 * Every protocol message's stream constructor, by tag, for Message.read.
 *
 * Under TeaVM 0.16 Wasm GC, Class.forName does not find the message
 * classes although the reflection policy selects them, so Message.read
 * (patched) looks here first. Generated from the message classes.
 */
final class MessageReaders {

    private MessageReaders() {}

    /** Register the readers; idempotent. */
    static synchronized void install() {
        final Map<String, Message.Reader> r = Message.readers;
        if (!r.isEmpty()) return;
        r.put(AbandonColonyMessage.TAG, AbandonColonyMessage::new);
        r.put(AddPlayerMessage.TAG, AddPlayerMessage::new);
        r.put(AnimateAttackMessage.TAG, AnimateAttackMessage::new);
        r.put(AnimateMoveMessage.TAG, AnimateMoveMessage::new);
        r.put(AskSkillMessage.TAG, AskSkillMessage::new);
        r.put(AssignTeacherMessage.TAG, AssignTeacherMessage::new);
        r.put(AssignTradeRouteMessage.TAG, AssignTradeRouteMessage::new);
        r.put(AttackMessage.TAG, AttackMessage::new);
        r.put(AttackRangedMessage.TAG, AttackRangedMessage::new);
        r.put(BuildColonyMessage.TAG, BuildColonyMessage::new);
        r.put(CashInTreasureTrainMessage.TAG, CashInTreasureTrainMessage::new);
        r.put(ChangeStateMessage.TAG, ChangeStateMessage::new);
        r.put(ChangeWorkImprovementTypeMessage.TAG, ChangeWorkImprovementTypeMessage::new);
        r.put(ChangeWorkTypeMessage.TAG, ChangeWorkTypeMessage::new);
        r.put(ChatMessage.TAG, ChatMessage::new);
        r.put(ChooseFoundingFatherMessage.TAG, ChooseFoundingFatherMessage::new);
        r.put(ClaimLandMessage.TAG, ClaimLandMessage::new);
        r.put(ClearSpecialityMessage.TAG, ClearSpecialityMessage::new);
        r.put(CloseMessage.TAG, CloseMessage::new);
        r.put(ConnectionVerificationMessage.TAG, ConnectionVerificationMessage::new);
        r.put(ContinueMessage.TAG, ContinueMessage::new);
        r.put(DeclareIndependenceMessage.TAG, DeclareIndependenceMessage::new);
        r.put(DeclineMoundsMessage.TAG, DeclineMoundsMessage::new);
        r.put(DeleteTradeRouteMessage.TAG, DeleteTradeRouteMessage::new);
        r.put(DeliverGiftMessage.TAG, DeliverGiftMessage::new);
        r.put(DemandTributeMessage.TAG, DemandTributeMessage::new);
        r.put(DiplomacyMessage.TAG, DiplomacyMessage::new);
        r.put(DisbandUnitMessage.TAG, DisbandUnitMessage::new);
        r.put(DisconnectMessage.TAG, DisconnectMessage::new);
        r.put(DisembarkMessage.TAG, DisembarkMessage::new);
        r.put(EmbarkMessage.TAG, EmbarkMessage::new);
        r.put(EmigrateUnitMessage.TAG, EmigrateUnitMessage::new);
        r.put(EndTurnMessage.TAG, EndTurnMessage::new);
        r.put(EnterRevengeModeMessage.TAG, EnterRevengeModeMessage::new);
        r.put(EquipForRoleMessage.TAG, EquipForRoleMessage::new);
        r.put(ErrorMessage.TAG, ErrorMessage::new);
        r.put(FeatureChangeMessage.TAG, FeatureChangeMessage::new);
        r.put(FirstContactMessage.TAG, FirstContactMessage::new);
        r.put(FountainOfYouthMessage.TAG, FountainOfYouthMessage::new);
        r.put(GameEndedMessage.TAG, GameEndedMessage::new);
        r.put(GameStateMessage.TAG, GameStateMessage::new);
        r.put(HighScoresMessage.TAG, HighScoresMessage::new);
        r.put(InciteMessage.TAG, InciteMessage::new);
        r.put(IndianDemandMessage.TAG, IndianDemandMessage::new);
        r.put(JoinColonyMessage.TAG, JoinColonyMessage::new);
        r.put(LearnSkillMessage.TAG, LearnSkillMessage::new);
        r.put(LoginMessage.TAG, LoginMessage::new);
        r.put(LoadGoodsMessage.TAG, LoadGoodsMessage::new);
        r.put(LogoutMessage.TAG, LogoutMessage::new);
        r.put(LootCargoMessage.TAG, LootCargoMessage::new);
        r.put(MissionaryMessage.TAG, MissionaryMessage::new);
        r.put(MonarchActionMessage.TAG, MonarchActionMessage::new);
        r.put(MoveMessage.TAG, MoveMessage::new);
        r.put(MoveToMessage.TAG, MoveToMessage::new);
        r.put(MultipleMessage.TAG, MultipleMessage::new);
        r.put(NationSummaryMessage.TAG, NationSummaryMessage::new);
        r.put(NativeGiftMessage.TAG, NativeGiftMessage::new);
        r.put(NativeTradeMessage.TAG, NativeTradeMessage::new);
        r.put(NewLandNameMessage.TAG, NewLandNameMessage::new);
        r.put(NewRegionNameMessage.TAG, NewRegionNameMessage::new);
        r.put(NewTradeRouteMessage.TAG, NewTradeRouteMessage::new);
        r.put(NewTurnMessage.TAG, NewTurnMessage::new);
        r.put(PartialMessage.TAG, PartialMessage::new);
        r.put(PayArrearsMessage.TAG, PayArrearsMessage::new);
        r.put(PayForBuildingMessage.TAG, PayForBuildingMessage::new);
        r.put(PutOutsideColonyMessage.TAG, PutOutsideColonyMessage::new);
        r.put(QuestionMessage.TAG, QuestionMessage::new);
        r.put(ReadyMessage.TAG, ReadyMessage::new);
        r.put(RearrangeColonyMessage.TAG, RearrangeColonyMessage::new);
        r.put(ReconnectMessage.TAG, ReconnectMessage::new);
        r.put(RegisterServerMessage.TAG, RegisterServerMessage::new);
        r.put(RemoveMessage.TAG, RemoveMessage::new);
        r.put(RemoveServerMessage.TAG, RemoveServerMessage::new);
        r.put(RenameMessage.TAG, RenameMessage::new);
        r.put(ReplyMessage.TAG, ReplyMessage::new);
        r.put(RequestLaunchMessage.TAG, RequestLaunchMessage::new);
        r.put(RetireMessage.TAG, RetireMessage::new);
        r.put(ScoutIndianSettlementMessage.TAG, ScoutIndianSettlementMessage::new);
        r.put(ScoutSpeakToChiefMessage.TAG, ScoutSpeakToChiefMessage::new);
        r.put(ServerListMessage.TAG, ServerListMessage::new);
        r.put(SetAIMessage.TAG, SetAIMessage::new);
        r.put(SetAvailableMessage.TAG, SetAvailableMessage::new);
        r.put(SetBuildQueueMessage.TAG, SetBuildQueueMessage::new);
        r.put(SetColorMessage.TAG, SetColorMessage::new);
        r.put(SetCurrentPlayerMessage.TAG, SetCurrentPlayerMessage::new);
        r.put(SetCurrentStopMessage.TAG, SetCurrentStopMessage::new);
        r.put(SetDeadMessage.TAG, SetDeadMessage::new);
        r.put(SetDestinationMessage.TAG, SetDestinationMessage::new);
        r.put(SetGoodsLevelsMessage.TAG, SetGoodsLevelsMessage::new);
        r.put(SetNationMessage.TAG, SetNationMessage::new);
        r.put(SetNationTypeMessage.TAG, SetNationTypeMessage::new);
        r.put(SetStanceMessage.TAG, SetStanceMessage::new);
        r.put(SpySettlementMessage.TAG, SpySettlementMessage::new);
        r.put(StartGameMessage.TAG, StartGameMessage::new);
        r.put(TrainUnitInEuropeMessage.TAG, TrainUnitInEuropeMessage::new);
        r.put(UnloadGoodsMessage.TAG, UnloadGoodsMessage::new);
        r.put(UpdateGameOptionsMessage.TAG, UpdateGameOptionsMessage::new);
        r.put(UpdateMapGeneratorOptionsMessage.TAG, UpdateMapGeneratorOptionsMessage::new);
        r.put(UpdateMessage.TAG, UpdateMessage::new);
        r.put(UpdateServerMessage.TAG, UpdateServerMessage::new);
        r.put(UpdateTradeRouteMessage.TAG, UpdateTradeRouteMessage::new);
        r.put(VacantPlayersMessage.TAG, VacantPlayersMessage::new);
        r.put(WorkMessage.TAG, WorkMessage::new);
    }
}
